import AVFoundation

/// Records a short voice clip (m4a/AAC) and transcribes it via /api/transcribe.
@MainActor
final class VoiceRecorder: ObservableObject {
    enum State: Equatable { case idle, recording, transcribing }
    @Published var state: State = .idle

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?
    private let client = ChatClient()

    var isRecording: Bool { state == .recording }
    var isBusy: Bool { state != .idle }

    func requestPermission() async -> Bool {
        await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { granted in cont.resume(returning: granted) }
        }
    }

    func start() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.duckOthers])
        try? session.setActive(true)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
        ]
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.record()
            recorder = rec
            fileURL = url
            state = .recording
        } catch {
            state = .idle
        }
    }

    /// Stop, transcribe, return text (nil on empty/failure). Cleans up the file.
    func stopAndTranscribe(language: String = "ru") async -> String? {
        guard let rec = recorder, let url = fileURL else { state = .idle; return nil }
        rec.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        state = .transcribing
        defer {
            state = .idle
            try? FileManager.default.removeItem(at: url)
        }
        let text = try? await client.transcribe(fileURL: url, language: language)
        let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (trimmed?.isEmpty ?? true) ? nil : trimmed
    }

    func cancel() {
        recorder?.stop()
        recorder = nil
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        state = .idle
    }
}
