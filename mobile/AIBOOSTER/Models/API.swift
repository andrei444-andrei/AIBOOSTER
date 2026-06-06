import Foundation

// MARK: - Mirror of lib/api-types.ts (web)
// Update by hand when the web API contract changes.
// Keep types narrow — only what mobile screens actually consume.

enum API {

    // MARK: Error shapes

    /// Nested admin form: { error: { code, message, error_id } } (§2).
    struct ErrorEnvelope: Decodable {
        let error: ErrorBody

        struct ErrorBody: Decodable {
            let code: String
            let message: String
            let errorId: String?

            enum CodingKeys: String, CodingKey {
                case code, message
                case errorId = "error_id"
            }
        }
    }

    /// Flat form used by job/video routes: { error: string, error_id? }.
    struct FlatError: Decodable {
        let error: String
        let errorId: String?

        enum CodingKeys: String, CodingKey {
            case error
            case errorId = "error_id"
        }
    }

    // MARK: Enums

    enum JobStatus: String, Decodable {
        case queued, running, done, error, cancelled
    }

    enum JobStage: String, Decodable {
        case download, asr, translate, tts, mux
    }

    enum WatchStatus: String, Decodable {
        case toWatch = "to_watch"
        case watched
    }

    enum JobSource: String, Decodable {
        case manual, playlist
    }

    // MARK: Feed — GET /api/jobs -> { jobs: [JobSummary] }

    struct JobsResponse: Decodable {
        let jobs: [JobSummary]
    }

    /// List item. Note the `yt_*` field names (vs normalized names in JobDetail).
    struct JobSummary: Decodable, Identifiable {
        let id: String
        let videoId: String
        let title: String?
        let durationSec: Int?
        let targetLang: String
        let status: JobStatus
        let stage: JobStage?
        let progress: Int
        let audioURL: String?
        let watchStatus: WatchStatus
        let lastPositionSec: Double
        let source: JobSource
        let summary: String?
        let createdAt: String

        enum CodingKeys: String, CodingKey {
            case id
            case videoId = "yt_video_id"
            case title = "yt_title"
            case durationSec = "yt_duration_sec"
            case targetLang = "target_lang"
            case status, stage, progress
            case audioURL = "audio_url"
            case watchStatus = "watch_status"
            case lastPositionSec = "last_position_sec"
            case source, summary
            case createdAt = "created_at"
        }
    }

    // MARK: Detail — GET /api/jobs/[id] -> { job, segments }

    struct JobDetailResponse: Decodable {
        let job: JobDetail
        let segments: [Segment]
    }

    struct JobDetail: Decodable, Identifiable {
        let id: String
        let url: String
        let videoId: String
        let title: String?
        let durationSec: Int?
        let sourceLang: String?
        let targetLang: String
        let quality: String
        let status: JobStatus
        let stage: JobStage?
        let progress: Int
        let errorMessage: String?
        let errorId: String?
        let audioURL: String?
        let watchStatus: WatchStatus
        let lastPositionSec: Double
        let source: JobSource
        let summary: String?
        let chapters: [Chapter]
        let createdAt: String
        let updatedAt: String
        let finishedAt: String?

        enum CodingKeys: String, CodingKey {
            case id, url
            case videoId = "video_id"
            case title
            case durationSec = "duration_sec"
            case sourceLang = "source_lang"
            case targetLang = "target_lang"
            case quality, status, stage, progress
            case errorMessage = "error_message"
            case errorId = "error_id"
            case audioURL = "audio_url"
            case watchStatus = "watch_status"
            case lastPositionSec = "last_position_sec"
            case source, summary, chapters
            case createdAt = "created_at"
            case updatedAt = "updated_at"
            case finishedAt = "finished_at"
        }
    }

    struct Chapter: Decodable, Identifiable {
        let startSec: Double
        let title: String
        var id: Double { startSec }

        enum CodingKeys: String, CodingKey {
            case startSec = "start_sec"
            case title
        }
    }

    struct Segment: Decodable, Identifiable {
        let idx: Int
        let startMs: Int
        let endMs: Int
        let sourceText: String?
        let translatedText: String?
        var id: Int { idx }

        enum CodingKeys: String, CodingKey {
            case idx
            case startMs = "start_ms"
            case endMs = "end_ms"
            case sourceText = "source_text"
            case translatedText = "translated_text"
        }
    }

    // MARK: Create — POST /api/translate-video

    struct CreateJobRequest: Encodable {
        let url: String
        let targetLang: String
        let quality: String

        enum CodingKeys: String, CodingKey {
            case url
            case targetLang = "target_lang"
            case quality
        }
    }

    struct CreateJobResponse: Decodable {
        let jobId: String
        let cached: Bool

        enum CodingKeys: String, CodingKey {
            case jobId = "job_id"
            case cached
        }
    }

    // MARK: Playback — PATCH /api/jobs/[id]

    struct PlaybackUpdate: Encodable {
        let lastPositionSec: Double?
        let watchStatus: String?

        enum CodingKeys: String, CodingKey {
            case lastPositionSec = "last_position_sec"
            case watchStatus = "watch_status"
        }
    }

    struct OK: Decodable {
        let ok: Bool
    }

    // MARK: Target languages (mirror of TARGET_LANGUAGES in lib/youtube.ts)

    struct Language: Identifiable, Hashable {
        let code: String
        let name: String
        var id: String { code }
    }

    static let targetLanguages: [Language] = [
        .init(code: "ru", name: "Русский"),
        .init(code: "en", name: "English"),
        .init(code: "es", name: "Español"),
        .init(code: "fr", name: "Français"),
        .init(code: "de", name: "Deutsch"),
        .init(code: "it", name: "Italiano"),
        .init(code: "pt", name: "Português"),
        .init(code: "pl", name: "Polski"),
        .init(code: "tr", name: "Türkçe"),
        .init(code: "uk", name: "Українська"),
        .init(code: "nl", name: "Nederlands"),
        .init(code: "cs", name: "Čeština"),
        .init(code: "ar", name: "العربية"),
        .init(code: "zh", name: "中文"),
        .init(code: "ja", name: "日本語"),
        .init(code: "ko", name: "한국어"),
        .init(code: "hi", name: "हिन्दी")
    ]
}
