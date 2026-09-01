use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

pub const MAX_EXPRESSION_BYTES: usize = 256;
pub const MAX_TOOL_ROUNDS: u32 = 4;
pub const MAX_TOOL_CALLS_PER_ROUND: u32 = 8;
pub const MAX_PAYLOAD_BYTES: usize = 64 * 1024;

#[derive(Debug, Error, PartialEq)]
pub enum ToolError {
    #[error("expression is too long")]
    TooLong,
    #[error("invalid expression")]
    Invalid,
    #[error("division by zero")]
    DivisionByZero,
    #[error("unsupported unit conversion")]
    UnsupportedUnit,
    #[error("tool result exceeds the runtime limit")]
    ResultTooLarge,
}

pub fn evaluate(expression: &str) -> Result<f64, ToolError> {
    if expression.len() > MAX_EXPRESSION_BYTES {
        return Err(ToolError::TooLong);
    }
    let mut parser = Parser {
        input: expression.as_bytes(),
        position: 0,
    };
    let value = parser.expression()?;
    parser.skip_space();
    if parser.position != parser.input.len() || !value.is_finite() {
        return Err(ToolError::Invalid);
    }
    Ok(value)
}

pub fn convert(value: f64, from: &str, to: &str) -> Result<f64, ToolError> {
    let from = from.trim().to_ascii_lowercase();
    let to = to.trim().to_ascii_lowercase();
    let base = match from.as_str() {
        "m" | "meter" | "meters" => value,
        "km" | "kilometer" | "kilometers" => value * 1000.0,
        "cm" | "centimeter" | "centimeters" => value / 100.0,
        "ft" | "foot" | "feet" => value * 0.3048,
        "mi" | "mile" | "miles" => value * 1609.344,
        "c" | "celsius" => value,
        "f" | "fahrenheit" => (value - 32.0) * 5.0 / 9.0,
        _ => return Err(ToolError::UnsupportedUnit),
    };
    let result = match to.as_str() {
        "m" | "meter" | "meters" => base,
        "km" | "kilometer" | "kilometers" => base / 1000.0,
        "cm" | "centimeter" | "centimeters" => base * 100.0,
        "ft" | "foot" | "feet" => base / 0.3048,
        "mi" | "mile" | "miles" => base / 1609.344,
        "c" | "celsius" => base,
        "f" | "fahrenheit" => base * 9.0 / 5.0 + 32.0,
        _ => return Err(ToolError::UnsupportedUnit),
    };
    if !result.is_finite() {
        return Err(ToolError::Invalid);
    }
    Ok(result)
}

pub fn validate_call(name: &str, arguments: &Value) -> Result<(), ToolError> {
    if !matches!(
        name,
        "calculator.evaluate"
            | "datetime.current"
            | "unit.convert"
            | "memory.list"
            | "memory.save"
            | "memory.delete"
            | "chat.search"
            | "file.read"
            | "file.metadata"
            | "system.info"
    ) {
        return Err(ToolError::Invalid);
    }
    if serde_json::to_vec(arguments)
        .map_err(|_| ToolError::Invalid)?
        .len()
        > MAX_PAYLOAD_BYTES
    {
        return Err(ToolError::ResultTooLarge);
    }
    Ok(())
}

pub fn host_result(
    call_id: &str,
    name: &str,
    status: &str,
    result: Option<Value>,
    error: Option<Value>,
) -> Value {
    json!({
        "protocolVersion": "juniper-tool-protocol-v1",
        "callId": call_id,
        "name": name,
        "status": status,
        "result": result,
        "error": error
    })
}

pub fn execute_call(
    call_id: &str,
    name: &str,
    arguments: &Value,
    round: u32,
    calls_this_round: u32,
) -> Value {
    if !loop_allowed(round, calls_this_round) {
        return host_result(
            call_id,
            name,
            "denied",
            None,
            Some(json!({
                "code": "TOOL_LOOP_LIMIT",
                "message": "Tool loop limit reached."
            })),
        );
    }
    if let Err(error) = validate_call(name, arguments) {
        return host_result(
            call_id,
            name,
            "error",
            None,
            Some(json!({ "code": "INVALID_TOOL_CALL", "message": error.to_string() })),
        );
    }

    let result = match name {
        "calculator.evaluate" => arguments
            .get("expression")
            .and_then(Value::as_str)
            .ok_or(ToolError::Invalid)
            .and_then(evaluate)
            .map(|value| json!({ "value": value })),
        "unit.convert" => arguments
            .get("value")
            .and_then(Value::as_f64)
            .zip(arguments.get("from").and_then(Value::as_str))
            .zip(arguments.get("to").and_then(Value::as_str))
            .map(|((value, from), to)| {
                convert(value, from, to)
                    .map(|result| json!({ "value": result, "from": from, "to": to }))
            })
            .unwrap_or(Err(ToolError::Invalid)),
        "datetime.current" => SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| json!({ "unixSeconds": duration.as_secs() }))
            .map_err(|_| ToolError::Invalid),
        _ => Err(ToolError::Invalid),
    };

    match result {
        Ok(value) => host_result(call_id, name, "success", Some(value), None),
        Err(error) => host_result(
            call_id,
            name,
            "error",
            None,
            Some(json!({
                "code": "TOOL_EXECUTION_ERROR",
                "message": error.to_string()
            })),
        ),
    }
}

pub fn loop_allowed(round: u32, calls_this_round: u32) -> bool {
    round < MAX_TOOL_ROUNDS && calls_this_round <= MAX_TOOL_CALLS_PER_ROUND
}

struct Parser<'a> {
    input: &'a [u8],
    position: usize,
}

impl Parser<'_> {
    fn skip_space(&mut self) {
        while self
            .input
            .get(self.position)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.position += 1;
        }
    }

    fn expression(&mut self) -> Result<f64, ToolError> {
        let mut value = self.term()?;
        loop {
            self.skip_space();
            match self.input.get(self.position) {
                Some(b'+') => {
                    self.position += 1;
                    value += self.term()?;
                }
                Some(b'-') => {
                    self.position += 1;
                    value -= self.term()?;
                }
                _ => break,
            }
        }
        Ok(value)
    }

    fn term(&mut self) -> Result<f64, ToolError> {
        let mut value = self.power()?;
        loop {
            self.skip_space();
            match self.input.get(self.position) {
                Some(b'*') => {
                    self.position += 1;
                    value *= self.power()?;
                }
                Some(b'/') => {
                    self.position += 1;
                    let divisor = self.power()?;
                    if divisor == 0.0 {
                        return Err(ToolError::DivisionByZero);
                    }
                    value /= divisor;
                }
                _ => break,
            }
        }
        Ok(value)
    }

    fn power(&mut self) -> Result<f64, ToolError> {
        let mut value = self.unary()?;
        self.skip_space();
        if self.input.get(self.position) == Some(&b'^') {
            self.position += 1;
            value = value.powf(self.power()?);
        }
        Ok(value)
    }

    fn unary(&mut self) -> Result<f64, ToolError> {
        self.skip_space();
        if self.input.get(self.position) == Some(&b'-') {
            self.position += 1;
            return Ok(-self.unary()?);
        }
        if self.input.get(self.position) == Some(&b'+') {
            self.position += 1;
            return self.unary();
        }
        self.primary()
    }

    fn primary(&mut self) -> Result<f64, ToolError> {
        self.skip_space();
        if self.input.get(self.position) == Some(&b'(') {
            self.position += 1;
            let value = self.expression()?;
            self.skip_space();
            if self.input.get(self.position) != Some(&b')') {
                return Err(ToolError::Invalid);
            }
            self.position += 1;
            return Ok(value);
        }
        let start = self.position;
        while self
            .input
            .get(self.position)
            .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'.')
        {
            self.position += 1;
        }
        if start == self.position {
            return Err(ToolError::Invalid);
        }
        std::str::from_utf8(&self.input[start..self.position])
            .ok()
            .and_then(|text| text.parse().ok())
            .ok_or(ToolError::Invalid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculator_is_deterministic() {
        assert_eq!(evaluate("847291 * 19347").unwrap(), 16392538977.0);
    }

    #[test]
    fn calculator_rejects_code() {
        assert_eq!(evaluate("1; process.exit()").unwrap_err(), ToolError::Invalid);
    }

    #[test]
    fn calculator_bounds_input() {
        assert_eq!(evaluate(&"1".repeat(257)).unwrap_err(), ToolError::TooLong);
    }

    #[test]
    fn conversion_is_explicit() {
        assert!((convert(1.0, "km", "m").unwrap() - 1000.0).abs() < f64::EPSILON);
        assert_eq!(
            convert(1.0, "parsec", "m").unwrap_err(),
            ToolError::UnsupportedUnit
        );
    }

    #[test]
    fn tool_result_is_host_shaped() {
        let result = host_result(
            "x",
            "calculator.evaluate",
            "success",
            Some(json!({ "value": 2 })),
            None,
        );
        assert_eq!(result["protocolVersion"], "juniper-tool-protocol-v1");
        assert_eq!(result["status"], "success");
    }

    #[test]
    fn host_executes_only_approved_safe_calls() {
        let result = execute_call(
            "x",
            "calculator.evaluate",
            &json!({ "expression": "2 + 2" }),
            0,
            1,
        );
        assert_eq!(result["status"], "success");
        assert_eq!(result["result"]["value"], 4.0);

        let unsupported = execute_call(
            "x",
            "memory.save",
            &json!({ "content": "secret" }),
            0,
            1,
        );
        assert_eq!(unsupported["status"], "error");
    }

    #[test]
    fn loop_is_bounded() {
        assert!(loop_allowed(0, 8));
        assert!(!loop_allowed(4, 0));
        assert!(!loop_allowed(0, 9));
    }
}
