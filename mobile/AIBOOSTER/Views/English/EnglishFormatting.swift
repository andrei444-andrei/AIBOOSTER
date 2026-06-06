import SwiftUI

/// Formatting helpers for the English dialogues screens.
enum EnglishFormat {
    static func stageLabel(_ stage: String?) -> String {
        switch stage {
        case "script": return "Сценарий"
        case "tts":    return "Озвучка"
        case "mux":    return "Сборка"
        default:       return "Генерация"
        }
    }

    static func status(_ status: String, stage: String?, progress: Int) -> (text: String, color: Color) {
        switch status {
        case "done":      return ("Готово", Theme.success)
        case "queued":    return ("В очереди", Theme.textMuted)
        case "running":   return ("\(stageLabel(stage)) · \(progress)%", Theme.info)
        case "error":     return ("Ошибка", Theme.youtube)
        case "cancelled": return ("Отменено", Theme.textMuted)
        default:          return (status, Theme.textMuted)
        }
    }

    static func kindLabel(_ kind: String) -> String {
        kind == "monologue" ? "Монолог" : "Диалог"
    }
}
