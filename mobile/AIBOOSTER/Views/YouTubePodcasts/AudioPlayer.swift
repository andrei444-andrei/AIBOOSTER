import AVFoundation
import Combine

/// Thin AVPlayer wrapper for streaming a translated episode's MP3.
/// UI mutations happen on the main queue (time observer + notifications use
/// `.main`), so this is a plain ObservableObject.
final class AudioPlayer: ObservableObject {
    @Published var isPlaying = false
    @Published var currentTime: Double = 0
    @Published var duration: Double = 0

    /// Fired when playback reaches the end.
    var onFinished: (() -> Void)?

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    func load(urlString: String, startAt: Double = 0) {
        guard player == nil, let url = URL(string: urlString) else { return }

        // .playback keeps audio going under the silent switch (and, once the
        // background-audio capability is added, while backgrounded).
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try? AVAudioSession.sharedInstance().setActive(true)

        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        player = p

        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = p.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            self.currentTime = time.seconds
            if let dur = self.player?.currentItem?.duration.seconds, dur.isFinite, dur > 0 {
                self.duration = dur
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            self?.isPlaying = false
            self?.onFinished?()
        }

        if startAt > 1 {
            p.seek(to: CMTime(seconds: startAt, preferredTimescale: 600))
            currentTime = startAt
        }
    }

    func togglePlay() {
        guard let player else { return }
        if isPlaying { player.pause() } else { player.play() }
        isPlaying.toggle()
    }

    func seek(to seconds: Double) {
        let clamped = max(0, seconds)
        player?.seek(to: CMTime(seconds: clamped, preferredTimescale: 600))
        currentTime = clamped
    }

    func skip(by delta: Double) {
        let target = currentTime + delta
        seek(to: duration > 0 ? min(duration, target) : max(0, target))
    }

    func teardown() {
        player?.pause()
        isPlaying = false
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player = nil
    }

    deinit {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    }
}
