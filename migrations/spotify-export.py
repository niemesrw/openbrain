#!/usr/bin/env python3
"""
Parse a Spotify data export and prepare insights for migration into Open Brain.

Usage:
    python3 migrations/spotify-export.py <path-to-my_spotify_data.zip>

This produces a JSON file (spotify-export.json) with summarized music preferences.
Review the file, remove entries you don't want, then run with --capture:

    python3 migrations/spotify-export.py spotify-export.json --capture \
      --api-url https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp \
      --api-key ob_YOUR_API_KEY

Zero external dependencies — uses only the Python standard library.

How to get your Spotify data:
    1. Go to spotify.com/account → Privacy settings → Download your data
    2. Request "Account data" (NOT "Extended streaming history" — that takes 30 days)
    3. Wait ~1 week for the email, then download the zip
"""

import argparse
import http.client
import json
import ssl
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse


def load_json_from_zip(zf: zipfile.ZipFile, filename: str) -> dict | list | None:
    """Load a JSON file from inside the zip, trying common path prefixes."""
    for prefix in ["Spotify Account Data/", "MyData/", ""]:
        try:
            return json.loads(zf.read(prefix + filename))
        except KeyError:
            continue
    return None


def analyze_streaming_history(zf: zipfile.ZipFile) -> dict:
    """Analyze streaming history for top artists, tracks, and listening patterns."""
    all_streams = []
    # Handle multiple streaming history files (StreamingHistory_music_0.json, _1.json, etc.)
    for name in zf.namelist():
        if "StreamingHistory" in name and name.endswith(".json"):
            data = json.loads(zf.read(name))
            if isinstance(data, list):
                all_streams.extend(data)

    if not all_streams:
        return {}

    # Only count tracks played for at least 30 seconds
    meaningful = [s for s in all_streams if s.get("msPlayed", 0) >= 30000]

    artist_plays = Counter(s["artistName"] for s in meaningful)
    artist_time = Counter()
    for s in meaningful:
        artist_time[s["artistName"]] += s.get("msPlayed", 0)

    track_plays = Counter(
        f"{s['artistName']} — {s['trackName']}" for s in meaningful
    )

    # Total listening time
    total_ms = sum(s.get("msPlayed", 0) for s in meaningful)
    total_hours = round(total_ms / 3_600_000, 1)

    # Date range
    dates = sorted(s.get("endTime", "") for s in meaningful if s.get("endTime"))

    # Monthly breakdown
    monthly = defaultdict(lambda: {"streams": 0, "ms": 0, "artists": Counter()})
    for s in meaningful:
        month = s["endTime"][:7]
        monthly[month]["streams"] += 1
        monthly[month]["ms"] += s.get("msPlayed", 0)
        monthly[month]["artists"][s["artistName"]] += 1

    monthly_data = []
    for month in sorted(monthly):
        m = monthly[month]
        top3 = [name for name, _ in m["artists"].most_common(3)]
        monthly_data.append({
            "month": month,
            "streams": m["streams"],
            "hours": round(m["ms"] / 3_600_000, 1),
            "top_artists": top3,
        })

    # Per-artist profiles (artists with 10+ plays)
    artist_tracks = defaultdict(Counter)
    for s in meaningful:
        artist_tracks[s["artistName"]][s["trackName"]] += 1

    artist_profiles = []
    for name, count in artist_plays.most_common():
        if count < 10:
            break
        top_tracks = [
            f"{track} ({c}x)" for track, c in artist_tracks[name].most_common(5)
        ]
        artist_profiles.append({
            "artist": name,
            "plays": count,
            "hours": round(artist_time[name] / 3_600_000, 1),
            "top_tracks": top_tracks,
        })

    return {
        "total_streams": len(meaningful),
        "total_hours": total_hours,
        "date_range": f"{dates[0][:10]} to {dates[-1][:10]}" if dates else "unknown",
        "top_artists_by_plays": [
            {"artist": name, "plays": count}
            for name, count in artist_plays.most_common(30)
        ],
        "top_artists_by_time": [
            {"artist": name, "hours": round(ms / 3_600_000, 1)}
            for name, ms in artist_time.most_common(15)
        ],
        "top_tracks": [
            {"track": name, "plays": count}
            for name, count in track_plays.most_common(30)
        ],
        "monthly": monthly_data,
        "artist_profiles": artist_profiles,
    }


def analyze_library(zf: zipfile.ZipFile) -> dict:
    """Analyze saved library (liked tracks, albums, artists)."""
    library = load_json_from_zip(zf, "YourLibrary.json")
    if not library or not isinstance(library, dict):
        return {}

    result = {}

    tracks = library.get("tracks", [])
    if tracks:
        # Artist distribution in saved tracks
        lib_artists = Counter(t.get("artist", "Unknown") for t in tracks)
        result["saved_tracks_count"] = len(tracks)
        result["top_saved_artists"] = [
            {"artist": name, "saved_tracks": count}
            for name, count in lib_artists.most_common(20)
        ]

    albums = library.get("albums", [])
    if albums:
        result["saved_albums_count"] = len(albums)
        album_artists = Counter(a.get("artist", "Unknown") for a in albums)
        result["top_album_artists"] = [
            {"artist": name, "albums": count}
            for name, count in album_artists.most_common(10)
        ]

    artists = library.get("artists", [])
    if artists:
        result["followed_artists"] = [a.get("name", "Unknown") for a in artists[:30]]

    return result


def analyze_playlists(zf: zipfile.ZipFile) -> list[dict]:
    """Extract playlist summaries."""
    data = load_json_from_zip(zf, "Playlist1.json")
    if not data or not isinstance(data, dict):
        return []

    playlists = []
    for p in data.get("playlists", []):
        items = p.get("items", [])
        if not items:
            continue

        # Get artist distribution within playlist
        playlist_artists = Counter()
        track_names = []
        for item in items:
            track = item.get("track", {})
            if track:
                playlist_artists[track.get("artistName", "Unknown")] += 1
                track_names.append(
                    f"{track.get('artistName', '?')} — {track.get('trackName', '?')}"
                )

        playlists.append({
            "name": p.get("name", "Untitled"),
            "track_count": len(items),
            "last_modified": p.get("lastModifiedDate", "unknown"),
            "top_artists": [
                f"{name} ({count})" for name, count in playlist_artists.most_common(5)
            ],
            "sample_tracks": track_names[:10],
        })

    return playlists


def build_thoughts(history: dict, library: dict, playlists: list[dict]) -> list[dict]:
    """Convert analysis into thoughts ready for capture."""
    thoughts = []

    # 1. Overall listening profile
    if history:
        top_10 = [a["artist"] for a in history.get("top_artists_by_plays", [])[:10]]
        top_tracks = [t["track"] for t in history.get("top_tracks", [])[:10]]
        parts = [
            f"Spotify listening profile ({history.get('date_range', 'recent')})",
            f"Total: {history.get('total_hours', '?')} hours across {history.get('total_streams', '?')} streams",
            f"Top artists: {', '.join(top_10)}",
            f"Most played tracks: {'; '.join(top_tracks)}",
        ]
        thoughts.append({
            "text": "\n".join(parts),
            "category": "listening_profile",
        })

    # 2. Listening time breakdown (top artists by hours)
    if history.get("top_artists_by_time"):
        lines = [f"  {a['artist']}: {a['hours']}h" for a in history["top_artists_by_time"]]
        thoughts.append({
            "text": "Top artists by listening time:\n" + "\n".join(lines),
            "category": "listening_time",
        })

    # 3. Library overview
    if library:
        parts = [f"Spotify library: {library.get('saved_tracks_count', 0)} saved tracks, {library.get('saved_albums_count', 0)} saved albums"]
        if library.get("top_saved_artists"):
            top = [f"{a['artist']} ({a['saved_tracks']})" for a in library["top_saved_artists"][:10]]
            parts.append(f"Most saved artists: {', '.join(top)}")
        if library.get("followed_artists"):
            parts.append(f"Followed artists: {', '.join(library['followed_artists'][:20])}")
        thoughts.append({
            "text": "\n".join(parts),
            "category": "library",
        })

    # 4. Monthly listening phases (group into quarters for digestible chunks)
    monthly = history.get("monthly", [])
    if monthly:
        # Group months into chunks of 3-4
        for i in range(0, len(monthly), 4):
            chunk = monthly[i:i + 4]
            lines = []
            for m in chunk:
                top = ", ".join(m["top_artists"])
                lines.append(f"  {m['month']}: {m['hours']}h, {m['streams']} streams — {top}")
            period = f"{chunk[0]['month']} to {chunk[-1]['month']}"
            thoughts.append({
                "text": f"Spotify listening phases ({period}):\n" + "\n".join(lines),
                "category": "monthly",
            })

    # 5. Artist profiles (top artists with their most-played tracks)
    profiles = history.get("artist_profiles", [])
    # Group into batches of 5 to avoid too many tiny thoughts
    for i in range(0, len(profiles), 5):
        batch = profiles[i:i + 5]
        lines = []
        for a in batch:
            tracks = "; ".join(a["top_tracks"][:3])
            lines.append(f"  {a['artist']}: {a['plays']} plays, {a['hours']}h — top tracks: {tracks}")
        rank_start = i + 1
        rank_end = i + len(batch)
        thoughts.append({
            "text": f"Spotify artist profiles (#{rank_start}-{rank_end} by plays):\n" + "\n".join(lines),
            "category": "artist_profile",
        })

    # 6. Each playlist as a separate thought
    for p in playlists:
        if p["track_count"] < 2:
            continue
        parts = [
            f"Spotify playlist: \"{p['name']}\" ({p['track_count']} tracks, last updated {p['last_modified']})",
            f"Main artists: {', '.join(p['top_artists'])}",
            f"Sample tracks: {'; '.join(p['sample_tracks'][:8])}",
        ]
        thoughts.append({
            "text": "\n".join(parts),
            "category": "playlist",
        })

    return thoughts


def _post_json(host: str, path: str, body: bytes, headers: dict) -> dict:
    """Make an HTTPS POST request and return parsed JSON."""
    ctx = ssl.create_default_context()
    conn = http.client.HTTPSConnection(host, timeout=30, context=ctx)  # nosemgrep: httpsconnection-detected
    try:
        conn.request("POST", path, body=body, headers=headers)
        resp = conn.getresponse()
        return json.loads(resp.read().decode("utf-8"))
    finally:
        conn.close()


def capture_to_brain(thoughts: list[dict], api_url: str, api_key: str) -> None:
    """Send thoughts to Open Brain via the MCP server."""
    parsed = urlparse(api_url)
    if parsed.scheme != "https":
        print("Error: API URL must use https://")
        sys.exit(1)

    host = parsed.hostname
    path = parsed.path

    captured = 0
    errors = 0
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
    }

    for i, thought in enumerate(thoughts):
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": i + 1,
            "method": "tools/call",
            "params": {
                "name": "capture_thought",
                "arguments": {"text": thought["text"]},
            },
        }).encode("utf-8")

        try:
            result = _post_json(host, path, payload, headers)
            if "error" in result:
                print(f"  [{i+1}/{len(thoughts)}] Error: {result['error']['message']}", flush=True)
                errors += 1
            else:
                content = result.get("result", {}).get("content", [{}])
                text = content[0].get("text", "") if content else ""
                print(f"  [{i+1}/{len(thoughts)}] {text}", flush=True)
                captured += 1
        except Exception as e:
            print(f"  [{i+1}/{len(thoughts)}] Failed: {e}", flush=True)
            errors += 1

    print(f"\nDone: {captured} captured, {errors} errors", flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="Parse Spotify data export and migrate to Open Brain"
    )
    parser.add_argument(
        "input_file",
        help="Path to my_spotify_data.zip (parse mode) or spotify-export.json (capture mode)",
    )
    parser.add_argument(
        "--capture",
        action="store_true",
        help="Capture from a reviewed JSON file (requires --api-url and --api-key, or API_URL/API_KEY env vars)",
    )
    parser.add_argument("--api-url", help="Open Brain API URL (e.g. https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/mcp)")
    parser.add_argument("--api-key", help="Agent API key (starts with ob_)")
    parser.add_argument(
        "--output",
        default="spotify-export.json",
        help="Output JSON file (default: spotify-export.json)",
    )
    args = parser.parse_args()

    input_path = Path(args.input_file)
    if not input_path.exists():
        print(f"Error: {input_path} not found")
        sys.exit(1)

    # Capture mode: read reviewed JSON and send to brain
    if args.capture:
        import os

        api_url = args.api_url or os.environ.get("API_URL")
        api_key = args.api_key or os.environ.get("API_KEY")

        if not api_url or not api_key:
            print("Error: --capture requires API_URL and API_KEY")
            print("  Set via env vars or --api-url / --api-key flags")
            print("  Create an API key with: brain create-agent migration")
            sys.exit(1)

        thoughts = json.loads(input_path.read_text())
        print(f"Capturing {len(thoughts)} thoughts to brain...", flush=True)
        capture_to_brain(thoughts, api_url, api_key)
        return

    # Parse mode: extract from zip and save JSON for review
    if not zipfile.is_zipfile(input_path):
        print(f"Error: {input_path} is not a valid zip file")
        sys.exit(1)

    print(f"Reading {input_path}...", flush=True)

    with zipfile.ZipFile(input_path) as zf:
        history = analyze_streaming_history(zf)
        library = analyze_library(zf)
        playlists = analyze_playlists(zf)

    if history:
        print(f"Streaming history: {history['total_streams']} streams, {history['total_hours']} hours", flush=True)
    if library:
        print(f"Library: {library.get('saved_tracks_count', 0)} tracks, {library.get('saved_albums_count', 0)} albums", flush=True)
    if playlists:
        print(f"Playlists: {len(playlists)}", flush=True)

    thoughts = build_thoughts(history, library, playlists)
    print(f"\nGenerated {len(thoughts)} thoughts:", flush=True)
    for t in thoughts:
        label = t.get("category", "?")
        preview = t["text"][:80].replace("\n", " ")
        print(f"  [{label}] {preview}...", flush=True)

    # Save to JSON for review
    output_path = Path(args.output)
    output_path.write_text(json.dumps(thoughts, indent=2, ensure_ascii=False))
    print(f"\nSaved to {output_path}", flush=True)
    print(f"\nNext steps:", flush=True)
    print(f"  1. Review {output_path} — edit or remove entries you don't want", flush=True)
    print(f"  2. Run: python3 {sys.argv[0]} {output_path} --capture --api-url <URL> --api-key <KEY>", flush=True)


if __name__ == "__main__":
    main()
