use serde::Serialize;
use std::path::Path;
use sysinfo::{Disks, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCapabilities {
    pub os: String,
    pub device_name: String,
    pub architecture: String,
    pub cpu_architecture: String,
    pub logical_cores: usize,
    pub total_memory_bytes: Option<u64>,
    pub available_memory_bytes: Option<u64>,
    pub memory_pressure: String,
    pub total_storage_bytes: Option<u64>,
    pub free_storage_bytes: Option<u64>,
    pub model_directory: String,
    pub gpu: String,
    pub acceleration: String,
}

pub fn collect(model_directory: &Path) -> DeviceCapabilities {
    let mut system = System::new();
    system.refresh_memory();
    let total_memory = nonzero(system.total_memory());
    let available_memory = nonzero(system.available_memory());
    let memory_pressure = match (total_memory, available_memory) {
        (Some(total), Some(available)) if available * 2 >= total => "low",
        (Some(total), Some(available)) if available * 5 >= total => "medium",
        (Some(_), Some(_)) => "high",
        _ => "unknown",
    }
    .into();
    let (total_storage, free_storage) = storage_for(model_directory);
    DeviceCapabilities {
        os: std::env::consts::OS.into(),
        device_name: System::host_name().unwrap_or_else(|| "This device".into()),
        architecture: std::env::consts::ARCH.into(),
        cpu_architecture: std::env::consts::ARCH.into(),
        logical_cores: std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(1),
        total_memory_bytes: total_memory,
        available_memory_bytes: available_memory,
        memory_pressure,
        total_storage_bytes: total_storage,
        free_storage_bytes: free_storage,
        model_directory: model_directory.to_string_lossy().into_owned(),
        gpu: "unknown".into(),
        acceleration: "unknown".into(),
    }
}

fn nonzero(value: u64) -> Option<u64> {
    (value > 0).then_some(value)
}

fn storage_for(path: &Path) -> (Option<u64>, Option<u64>) {
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|disk| path.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().to_string_lossy().len())
        .map(|disk| (nonzero(disk.total_space()), nonzero(disk.available_space())))
        .unwrap_or((None, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_a_nonzero_cpu_shape_without_claiming_gpu_support() {
        let capabilities = collect(Path::new("/tmp"));
        assert!(capabilities.logical_cores > 0);
        assert_eq!(capabilities.gpu, "unknown");
        assert_eq!(capabilities.acceleration, "unknown");
    }
}
