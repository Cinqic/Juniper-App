//! Juniper Device Link protocol primitives.
//!
//! This module intentionally contains no socket listener. The transport layer
//! must supply TLS 1.3 with certificate/public-key pinning and call these
//! primitives for framing, pairing, replay protection, and authorization. By
//! keeping the policy independent of discovery, a future mDNS or QR transport
//! cannot accidentally become an unauthenticated control channel.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::collections::{HashSet, VecDeque};
#[cfg(test)]
use std::net::{IpAddr, SocketAddr};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
pub const PAIRING_LIFETIME_SECONDS: u64 = 10 * 60;
const REPLAY_WINDOW: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Scope {
    Inference,
    AppControl,
    ModelRuntimeInspection,
    ModelManagement,
    DataSync,
}

impl Scope {
    pub fn allows(self, operation: &str) -> bool {
        match self {
            Self::Inference => matches!(operation, "inference.start" | "inference.cancel"),
            Self::AppControl => matches!(operation, "app.select-assistant" | "app.open-page"),
            Self::ModelRuntimeInspection => {
                matches!(operation, "runtime.inventory" | "model.inspect")
            }
            Self::ModelManagement => matches!(
                operation,
                "model.list" | "model.download" | "model.delete" | "model.select"
            ),
            Self::DataSync => matches!(operation, "data.sync"),
        }
    }
}

pub fn required_scope(operation: &str) -> Option<Scope> {
    [
        Scope::Inference,
        Scope::AppControl,
        Scope::ModelRuntimeInspection,
        Scope::ModelManagement,
        Scope::DataSync,
    ]
    .into_iter()
    .find(|scope| scope.allows(operation))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLinkPeer {
    pub id: String,
    pub name: String,
    pub fingerprint: String,
    pub scopes: Vec<Scope>,
    pub connected: bool,
    pub last_seen_at: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingOffer {
    pub protocol_version: u16,
    pub session_id: String,
    pub host_device_id: String,
    pub host_fingerprint: String,
    pub token: String,
    pub auth_string: String,
    pub expires_at: u64,
    pub qr_payload: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingProof {
    pub session_id: String,
    pub peer_id: String,
    pub peer_name: String,
    pub peer_fingerprint: String,
    pub token: String,
}

#[derive(Debug, Clone)]
pub struct PairingSession {
    pub session_id: String,
    pub host_device_id: String,
    pub host_fingerprint: String,
    secret: [u8; 32],
    pub expires_at: u64,
    consumed: bool,
}

impl PairingSession {
    pub fn start(host_device_id: &str, host_fingerprint: &str, now: u64) -> (Self, PairingOffer) {
        let first = *Uuid::new_v4().as_bytes();
        let second = *Uuid::new_v4().as_bytes();
        let mut secret = [0u8; 32];
        secret[..16].copy_from_slice(&first);
        secret[16..].copy_from_slice(&second);
        let session_id = Uuid::new_v4().to_string();
        let expires_at = now.saturating_add(PAIRING_LIFETIME_SECONDS);
        let token = URL_SAFE_NO_PAD.encode(secret);
        let auth_string = short_auth_string(&secret, &session_id);
        let offer = PairingOffer {
            protocol_version: PROTOCOL_VERSION,
            session_id: session_id.clone(),
            host_device_id: host_device_id.to_owned(),
            host_fingerprint: host_fingerprint.to_owned(),
            token: token.clone(),
            auth_string,
            expires_at,
            qr_payload: serde_json::json!({
                "protocol": "juniper-device-link",
                "version": PROTOCOL_VERSION,
                "sessionId": session_id,
                "hostDeviceId": host_device_id,
                "hostFingerprint": host_fingerprint,
                "token": token,
                "expiresAt": expires_at,
            })
            .to_string(),
        };
        (
            Self {
                session_id,
                host_device_id: host_device_id.to_owned(),
                host_fingerprint: host_fingerprint.to_owned(),
                secret,
                expires_at,
                consumed: false,
            },
            offer,
        )
    }

    pub fn complete(&mut self, proof: &PairingProof, now: u64) -> Result<DeviceLinkPeer, String> {
        if self.consumed {
            return Err("DEVICE_LINK_PAIRING_USED: Pairing codes are one-time use.".into());
        }
        if now > self.expires_at {
            return Err("DEVICE_LINK_PAIRING_EXPIRED: Pairing code has expired.".into());
        }
        if proof.session_id != self.session_id {
            return Err("DEVICE_LINK_PAIRING_INVALID: Pairing session does not match.".into());
        }
        let supplied = URL_SAFE_NO_PAD
            .decode(&proof.token)
            .map_err(|_| "DEVICE_LINK_PAIRING_INVALID: Pairing code is malformed.".to_owned())?;
        if supplied.as_slice() != self.secret {
            return Err("DEVICE_LINK_PAIRING_INVALID: Pairing code is not valid.".into());
        }
        validate_identity(&proof.peer_id, &proof.peer_name, &proof.peer_fingerprint)?;
        self.consumed = true;
        Ok(DeviceLinkPeer {
            id: proof.peer_id.clone(),
            name: proof.peer_name.clone(),
            fingerprint: proof.peer_fingerprint.clone(),
            // Pairing never silently grants control, model management, or
            // data sync. Those scopes require a separate explicit approval.
            scopes: vec![Scope::Inference],
            connected: false,
            last_seen_at: None,
            address: None,
        })
    }
}

fn validate_identity(id: &str, name: &str, fingerprint: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || name.is_empty()
        || name.len() > 128
        || fingerprint.is_empty()
        || fingerprint.len() > 256
        || [id, name, fingerprint]
            .into_iter()
            .any(|value| value.chars().any(char::is_control))
    {
        return Err("DEVICE_LINK_PAIRING_INVALID: Peer identity is invalid.".into());
    }
    Ok(())
}

fn short_auth_string(secret: &[u8; 32], session_id: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts a 32-byte key");
    mac.update(b"juniper-device-link-sas-v1");
    mac.update(session_id.as_bytes());
    let digest = mac.finalize().into_bytes();
    digest[..6]
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub protocol_version: u16,
    pub message_id: String,
    pub operation: String,
    pub payload: Value,
}

impl Envelope {
    pub fn new(message_id: &str, operation: &str, payload: Value) -> Result<Self, String> {
        if message_id.is_empty()
            || message_id.len() > 128
            || operation.is_empty()
            || operation.len() > 128
            || [message_id, operation]
                .into_iter()
                .any(|value| value.chars().any(char::is_control))
        {
            return Err("DEVICE_LINK_FRAME_INVALID: Message identity is invalid.".into());
        }
        if required_scope(operation).is_none() {
            return Err("DEVICE_LINK_OPERATION_UNSUPPORTED: Operation is not allowlisted.".into());
        }
        Ok(Self {
            protocol_version: PROTOCOL_VERSION,
            message_id: message_id.to_owned(),
            operation: operation.to_owned(),
            payload,
        })
    }
}

pub fn encode_frame(envelope: &Envelope) -> Result<Vec<u8>, String> {
    let payload = serde_json::to_vec(envelope)
        .map_err(|_| "DEVICE_LINK_FRAME_INVALID: Message could not be encoded.".to_owned())?;
    if payload.is_empty() || payload.len() > MAX_FRAME_BYTES {
        return Err("DEVICE_LINK_FRAME_TOO_LARGE: Message exceeds the 1 MiB limit.".into());
    }
    let length = u32::try_from(payload.len())
        .map_err(|_| "DEVICE_LINK_FRAME_TOO_LARGE: Message exceeds the frame limit.".to_owned())?;
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub fn decode_frame(frame: &[u8]) -> Result<Envelope, String> {
    if frame.len() < 4 {
        return Err("DEVICE_LINK_FRAME_INVALID: Frame length prefix is missing.".into());
    }
    let declared = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
    if declared == 0 || declared > MAX_FRAME_BYTES || declared + 4 != frame.len() {
        return Err("DEVICE_LINK_FRAME_INVALID: Frame length is invalid.".into());
    }
    let envelope: Envelope = serde_json::from_slice(&frame[4..])
        .map_err(|_| "DEVICE_LINK_FRAME_INVALID: Message is not valid JSON.".to_owned())?;
    if envelope.protocol_version != PROTOCOL_VERSION {
        return Err("DEVICE_LINK_VERSION_UNSUPPORTED: Protocol version is unsupported.".into());
    }
    Envelope::new(&envelope.message_id, &envelope.operation, envelope.payload)
}

#[derive(Debug, Default)]
pub struct ReplayGuard {
    ids: HashSet<String>,
    order: VecDeque<String>,
}

impl ReplayGuard {
    pub fn accept(&mut self, message_id: &str) -> Result<(), String> {
        if message_id.is_empty() || !self.ids.insert(message_id.to_owned()) {
            return Err("DEVICE_LINK_REPLAY: Message was already received.".into());
        }
        self.order.push_back(message_id.to_owned());
        while self.order.len() > REPLAY_WINDOW {
            if let Some(old) = self.order.pop_front() {
                self.ids.remove(&old);
            }
        }
        Ok(())
    }
}

pub fn authorize(peer: &DeviceLinkPeer, operation: &str) -> Result<(), String> {
    let required = required_scope(operation).ok_or_else(|| {
        "DEVICE_LINK_OPERATION_UNSUPPORTED: Operation is not allowlisted.".to_owned()
    })?;
    if peer.scopes.contains(&required) {
        Ok(())
    } else {
        Err("DEVICE_LINK_SCOPE_DENIED: Peer does not have the required scope.".into())
    }
}

pub fn validate_inference_payload(payload: &Value) -> Result<(), String> {
    if payload.get("privateChat").and_then(Value::as_bool) == Some(true) {
        return Err("DEVICE_LINK_PRIVATE_CHAT: Private chats never leave this device.".into());
    }
    if payload.get("hostContext").is_some() {
        return Err(
            "DEVICE_LINK_HOST_CONTEXT: Host context is not accepted over Device Link.".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
fn is_lan_address_syntax_hint(address: &str) -> bool {
    if let Ok(url) = reqwest::Url::parse(address)
        && let Some(host) = url.host_str()
    {
        return is_lan_host(host);
    }
    if let Ok(socket) = address.parse::<SocketAddr>() {
        return is_lan_ip(socket.ip());
    }
    if let Ok(ip) = address.parse::<IpAddr>() {
        return is_lan_ip(ip);
    }
    let host = address
        .split(':')
        .next()
        .unwrap_or(address)
        .trim_end_matches('.');
    is_lan_host(host)
}

#[cfg(test)]
fn is_lan_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => value.is_private() || value.is_link_local(),
        IpAddr::V6(value) => value.is_unique_local() || value.is_unicast_link_local(),
    }
}

#[cfg(test)]
fn is_lan_host(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok_and(is_lan_ip) || host.trim_end_matches('.').ends_with(".local")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_is_one_time_and_grants_inference_only() {
        let (mut session, offer) = PairingSession::start("host-1", "SHA256:host", 100);
        assert_eq!(offer.protocol_version, PROTOCOL_VERSION);
        let proof = PairingProof {
            session_id: offer.session_id,
            peer_id: "peer-1".into(),
            peer_name: "Phone".into(),
            peer_fingerprint: "SHA256:peer".into(),
            token: offer.token,
        };
        let peer = session.complete(&proof, 101).expect("pairing should work");
        assert_eq!(peer.scopes, vec![Scope::Inference]);
        assert!(session.complete(&proof, 101).is_err());
    }

    #[test]
    fn pairing_expiry_and_bad_token_are_rejected() {
        let (mut session, offer) = PairingSession::start("host-1", "fingerprint", 100);
        let mut proof = PairingProof {
            session_id: offer.session_id,
            peer_id: "peer-1".into(),
            peer_name: "Phone".into(),
            peer_fingerprint: "fingerprint".into(),
            token: "bad".into(),
        };
        assert!(session.complete(&proof, 101).is_err());
        proof.token = offer.token;
        assert!(
            session
                .complete(&proof, 100 + PAIRING_LIFETIME_SECONDS + 1)
                .is_err()
        );
    }

    #[test]
    fn framing_is_bounded_versioned_and_replay_protected() {
        let envelope = Envelope::new("message-1", "runtime.inventory", serde_json::json!({}))
            .expect("operation should be allowlisted");
        let frame = encode_frame(&envelope).expect("frame should encode");
        let decoded = decode_frame(&frame).expect("frame should decode");
        assert_eq!(decoded.message_id, "message-1");
        let mut guard = ReplayGuard::default();
        guard
            .accept(&decoded.message_id)
            .expect("first frame should pass");
        assert!(guard.accept(&decoded.message_id).is_err());
        assert!(decode_frame(&[0, 0, 0, 0]).is_err());
    }

    #[test]
    fn private_chat_and_control_scopes_are_explicitly_denied() {
        let peer = DeviceLinkPeer {
            id: "peer".into(),
            name: "Phone".into(),
            fingerprint: "fp".into(),
            scopes: vec![Scope::Inference],
            connected: false,
            last_seen_at: None,
            address: None,
        };
        assert!(authorize(&peer, "inference.start").is_ok());
        assert!(authorize(&peer, "app.select-assistant").is_err());
        assert!(validate_inference_payload(&serde_json::json!({"privateChat": true})).is_err());
        assert!(validate_inference_payload(&serde_json::json!({"messages": []})).is_ok());
    }

    #[test]
    fn only_private_or_link_local_endpoints_are_accepted() {
        // This is syntax classification for policy tests only. A future
        // transport must resolve hostnames and validate every destination IP.
        assert!(is_lan_address_syntax_hint("192.168.1.5:8443"));
        assert!(is_lan_address_syntax_hint("device.local:8443"));
        assert!(!is_lan_address_syntax_hint("8.8.8.8:443"));
    }
}
