// TruNorthWidget — Home/Lock-Screen widget for TruNorth.
//
// Shows the user's basket standing (clashes on the record + alignment) and a
// one-tap route into the in-store scanner — "presence at the moment of need."
//
// DATA BRIDGE: the JS app writes a JSON blob into the shared App Group
// (group.com.trunorthapp.app) via @capacitor/preferences configured with that
// group (see src/lib/widget.js). This widget reads it. It tries a couple of key
// spellings because @capacitor/preferences may prefix keys ("CapacitorStorage.").
// See docs/widget-setup.md for the one-time Xcode wire-up.
//
// The widget refreshes on its own timeline (~30 min) — no push needed; widgets
// aren't real-time and the basket changes rarely.

import WidgetKit
import SwiftUI

// MARK: - Shared config
private let appGroup = "group.com.trunorthapp.app"
private let candidateKeys = ["tn_widget", "CapacitorStorage.tn_widget"]

// MARK: - Model
struct BasketSnapshot: Codable {
    var pct: Int?          // % of graded basket brands that are aligned (A/B), or nil
    var clashes: Int       // count of D/F brands in the basket
    var graded: Int        // graded brands in the basket
    var savedCount: Int    // total saved brands
    var topClash: String?  // name of the worst-graded basket brand
    var updatedAt: Double? // ms epoch of last write

    static let placeholder = BasketSnapshot(pct: 82, clashes: 1, graded: 6, savedCount: 8, topClash: "ExxonMobil", updatedAt: nil)
    static let empty = BasketSnapshot(pct: nil, clashes: 0, graded: 0, savedCount: 0, topClash: nil, updatedAt: nil)
}

private func readSnapshot() -> BasketSnapshot {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return .empty }
    for key in candidateKeys {
        if let raw = defaults.string(forKey: key),
           let data = raw.data(using: .utf8),
           let snap = try? JSONDecoder().decode(BasketSnapshot.self, from: data) {
            return snap
        }
    }
    return .empty
}

// MARK: - Timeline
struct BasketEntry: TimelineEntry {
    let date: Date
    let snap: BasketSnapshot
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> BasketEntry {
        BasketEntry(date: Date(), snap: .placeholder)
    }
    func getSnapshot(in context: Context, completion: @escaping (BasketEntry) -> Void) {
        completion(BasketEntry(date: Date(), snap: context.isPreview ? .placeholder : readSnapshot()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<BasketEntry>) -> Void) {
        let entry = BasketEntry(date: Date(), snap: readSnapshot())
        // Refresh ~every 30 minutes; the app also nudges data on foreground.
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Palette (Civic Premium)
private let ink = Color(red: 0x0E/255, green: 0x0F/255, blue: 0x12/255)
private let ink2 = Color(red: 0x16/255, green: 0x18/255, blue: 0x1D/255)
private let bone = Color(red: 0xED/255, green: 0xE9/255, blue: 0xE0/255)
private let bone3 = Color(red: 0x9A/255, green: 0x94/255, blue: 0x89/255)
private let verdigris = Color(red: 0x38/255, green: 0xC0/255, blue: 0xCE/255)
private let oxblood = Color(red: 0xE0/255, green: 0x52/255, blue: 0x4D/255)
private let brass = Color(red: 0xC9/255, green: 0xA8/255, blue: 0x6A/255)

// MARK: - Views
struct TruNorthWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: Provider.Entry

    private var snap: BasketSnapshot { entry.snap }
    private var hasBasket: Bool { snap.graded > 0 || snap.savedCount > 0 }

    var body: some View {
        ZStack {
            LinearGradient(colors: [ink, ink2], startPoint: .top, endPoint: .bottom)
            content
                .padding(family == .systemSmall ? 12 : 16)
        }
        // Deep-link: tapping the widget opens the app straight to the scanner.
        .widgetURL(URL(string: "trunorth://scan?src=widget"))
    }

    @ViewBuilder private var content: some View {
        if !hasBasket {
            emptyState
        } else {
            switch family {
            case .systemMedium: mediumState
            default: smallState
            }
        }
    }

    // No basket yet → invite the core action.
    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            wordmark
            Spacer(minLength: 0)
            Text("Scan a product for its grade")
                .font(.system(size: family == .systemSmall ? 15 : 17, weight: .semibold))
                .foregroundColor(bone)
                .fixedSize(horizontal: false, vertical: true)
            Text("Records, not opinions").font(.system(size: 11)).foregroundColor(bone3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var smallState: some View {
        VStack(alignment: .leading, spacing: 4) {
            wordmark
            Spacer(minLength: 0)
            headline
            subline
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var mediumState: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                wordmark
                Spacer(minLength: 0)
                headline
                subline
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 8) {
                if let name = snap.topClash, snap.clashes > 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("SHARPEST CLASH").font(.system(size: 8, weight: .bold)).tracking(1).foregroundColor(bone3)
                        Text(name).font(.system(size: 13, weight: .semibold)).foregroundColor(bone).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Label("Scan", systemImage: "viewfinder")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(ink)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(verdigris).clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var wordmark: some View {
        HStack(spacing: 4) {
            Image(systemName: "location.north.fill").font(.system(size: 10, weight: .black)).foregroundColor(verdigris)
            Text("TruNorth").font(.system(size: 12, weight: .heavy)).foregroundColor(bone)
        }
    }

    // Clash-led headline (mirrors the in-app Today card).
    private var headline: some View {
        Group {
            if snap.clashes == 0 {
                Text("Nothing clashes.").font(.system(size: 18, weight: .semibold)).foregroundColor(bone)
            } else {
                (Text("\(snap.clashes)").foregroundColor(oxblood)
                 + Text(snap.clashes == 1 ? " clash" : " clashes").foregroundColor(bone))
                    .font(.system(size: 18, weight: .semibold))
            }
        }
        .lineLimit(1).minimumScaleFactor(0.7)
    }

    private var subline: some View {
        Text(sublineText).font(.system(size: 11)).foregroundColor(bone3).lineLimit(1)
    }
    private var sublineText: String {
        if let pct = snap.pct { return "\(pct)% aligned · \(snap.graded) graded" }
        return "\(snap.graded) graded in your basket"
    }
}

// MARK: - Widget + Bundle
struct TruNorthWidget: Widget {
    let kind = "TruNorthWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            TruNorthWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Your Basket")
        .description("Clashes on the record + a one-tap scan.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct TruNorthWidgetBundle: WidgetBundle {
    var body: some Widget { TruNorthWidget() }
}
