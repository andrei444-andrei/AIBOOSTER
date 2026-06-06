import SwiftUI
import UIKit

/// A chat bubble — right-aligned accent for the user, left surface for the
/// assistant (markdown). Shows a typing indicator while streaming empty.
struct MessageBubble: View {
    let message: DisplayMessage

    var body: some View {
        HStack {
            if message.isUser { Spacer(minLength: 44) }

            VStack(alignment: .leading, spacing: 8) {
                if let b64 = message.imageBase64,
                   let data = Data(base64Encoded: b64),
                   let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                }

                if !message.content.isEmpty {
                    bubbleText
                } else if message.isStreaming {
                    TypingDots()
                }
            }
            .padding(.horizontal, Theme.Space.s4)
            .padding(.vertical, Theme.Space.s3)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(message.isUser ? Color.clear : Theme.border, lineWidth: 1)
            )

            if !message.isUser { Spacer(minLength: 44) }
        }
    }

    @ViewBuilder private var bubbleText: some View {
        if message.isUser {
            Text(message.content)
                .font(.system(size: 15))
                .foregroundStyle(Color.white)
                .textSelection(.enabled)
        } else {
            Text(NewsFormat.markdown(message.content))
                .font(.system(size: 15))
                .foregroundStyle(message.failed ? Theme.youtube : Theme.text)
                .textSelection(.enabled)
        }
    }

    private var background: some View {
        (message.isUser ? Theme.accent : Theme.surface)
    }
}

/// Three-dot "assistant is typing" indicator.
struct TypingDots: View {
    @State private var animating = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(Theme.textMuted)
                    .frame(width: 6, height: 6)
                    .opacity(animating ? 1 : 0.3)
                    .animation(
                        .easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.2),
                        value: animating
                    )
            }
        }
        .onAppear { animating = true }
    }
}
