import SwiftUI

/// Shared formatting helpers for the podcasts screens.
enum PodcastFormat {
    static func thumbnailURL(_ videoId: String) -> URL? {
        URL(string: "https://img.youtube.com/vi/\(videoId)/hqdefault.jpg")
    }

    static func stageLabel(_ stage: API.JobStage?) -> String {
        switch stage {
        case .download: return "Скачивание"
        case .asr: return "Распознавание"
        case .translate: return "Перевод"
        case .tts: return "Озвучка"
        case .mux: return "Сборка"
        case nil: return "Обработка"
        }
    }

    /// mm:ss (or h:mm:ss for long content).
    static func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }

    static func duration(_ sec: Int?) -> String? {
        guard let sec, sec > 0 else { return nil }
        return time(Double(sec))
    }

    /// Short status label + tint for a job.
    static func status(_ status: API.JobStatus, stage: API.JobStage?, progress: Int) -> (text: String, color: Color) {
        switch status {
        case .done:      return ("Готово", Theme.success)
        case .queued:    return ("В очереди", Theme.textMuted)
        case .running:   return ("\(stageLabel(stage)) · \(progress)%", Theme.info)
        case .error:     return ("Ошибка", Theme.youtube)
        case .cancelled: return ("Отменено", Theme.textMuted)
        }
    }
}
