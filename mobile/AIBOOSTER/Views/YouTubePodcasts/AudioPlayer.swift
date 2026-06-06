import AVFoundation
import Combine
import MediaPlayer

/// AVPlayer wrapper for streaming an episode/dialogue MP3.
/// Plays in the background (UIBackgroundModes: audio + .playback session),
/// shows Now Playing info / lock-screen controls, and persists the playback
/// position periodically (also while backgrounded) via `onPersistPosition`.
final class AudioPlayer: ObservableObject {
    @Published var isPlaying = false
    @Published var currentTime: Double = 0
    @Published var duration: Double = 0

    /// Fired when playback reaches the end.
    var onFinished: (() -> Void)?
    /// Called ~every 10s while playing, and on pause/seek-to-end/teardown, with
    /// the current position — so the server keeps an up-to-date last position
    /// even when the app is backgrounded.
    var onPersistPosition: ((Double) -> Void)?

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var title = "AIBooster"
    private var lastPersisted: Double = 0

    func load(urlString: String, startAt: Double = 0, title: String = "AIBooster") {
        guard player == nil, let url = URL(string: urlString) else { return }
        self.title = title

        // .playback + the audio background mode keeps sound going when the app
        // is backgrounded or the screen is locked.
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
            if self.isPlaying, time.seconds - self.lastPersisted >= 10 {
                self.lastPersisted = time.seconds
                self.onPersistPosition?(time.seconds)
                self.updateNowPlaying()
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.isPlaying = false
            self.onPersistPosition?(self.currentTime)
            self.updateNowPlaying()
            self.onFinished?()
        }

        setupRemoteCommands()
        if startAt > 1 {
            p.seek(to: CMTime(seconds: startAt, preferredTimescale: 600))
            currentTime = startAt
            lastPersisted = startAt
        }
        updateNowPlaying()
    }

    func play() {
        player?.play()
        isPlaying = true
        updateNowPlaying()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        onPersistPosition?(currentTime)
        updateNowPlaying()
    }

    func togglePlay() {
        guard player != nil else { return }
        isPlaying ? pause() : play()
    }

    func seek(to seconds: Double) {
        let clamped = max(0, seconds)
        player?.seek(to: CMTime(seconds: clamped, preferredTimescale: 600))
        currentTime = clamped
        updateNowPlaying()
    }

    func skip(by delta: Double) {
        let target = currentTime + delta
        seek(to: duration > 0 ? min(duration, target) : max(0, target))
    }

    /// Force a position save (e.g. when the app moves to the background).
    func persistNow() {
        onPersistPosition?(currentTime)
    }

    func teardown() {
        onPersistPosition?(currentTime)
        player?.pause()
        isPlaying = false
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        clearRemoteCommands()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        player = nil
    }

    deinit {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    }

    // MARK: Lock-screen / Now Playing

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        clearRemoteCommands()
        center.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in self?.togglePlay(); return .success }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { [weak self] _ in self?.skip(by: 15); return .success }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in self?.skip(by: -15); return .success }
    }

    private func clearRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        [
            center.playCommand, center.pauseCommand, center.togglePlayPauseCommand,
            center.skipForwardCommand, center.skipBackwardCommand
        ].forEach { $0.removeTarget(nil) }
    }

    private func updateNowPlaying() {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: "AIBooster",
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentTime,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
