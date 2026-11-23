# Music Video Adventures

The page at https://advancedstudios.net/music-videos/: a set with channels. Up and down change channel, left and right change video inside a channel.

- The page (`index.html`, `app.js`) names no channel and no video. It reads `channels.json` from the media host.
- The media host is its own Cloudflare Pages project (`advancedstudios-music-videos`, https://media.advancedstudios.net). The video is HLS: 1080p, 720p and 480p in 4-second pieces, every file far under the 25 MiB limit. Video is never in this repo.
- The one data file is **not in this repo either**: `~/Services/music-videos-media/videos.json` on the studio box. This repo is public, and the data can hold a channel that is switched off. `tools/mv-publish` reads the data and writes the public part of it to the media host.

## Add a video

1. Put the finished file in one of the folders listed in `~/Services/music-videos-media/sources`.
2. Add one entry to the right channel's `videos` in `~/Services/music-videos-media/videos.json`:

   ```json
   {
     "id": "song-name",
     "title": "Song Name",
     "artist": "The Artist",
     "concept": "One sentence about the picture.",
     "source": "song_name.mp4"
   }
   ```

   The order of the entries is the order on the channel. `"poster_at": 42.5` picks the poster frame in seconds; leave it out and the poster is taken a quarter of the way in.
3. Run `music-videos/tools/mv-publish`. It encodes what is missing (one ffmpeg, under nice), takes the poster, checks the staging folder, deploys, and checks the live hosts.

That is all: no HTML, no script, no commit. The page shows it on the next load.

The deploy takes its Cloudflare token through `op run` from the references in `~/Services/music-videos-media/deploy.env`. That file is local; no vault path belongs in this repo.

## Channels, and switching one off

A channel in the data looks like this:

```json
{
  "id": "channel-id",
  "name": "Channel Name",
  "public": true,
  "intro": "One line in his voice. *THIS* is emphasis.",
  "notice": "Optional small print. {contact} becomes the removalContact address.",
  "next_up": { "title": "Next up", "line": "Optional card at the end of the channel." },
  "videos": []
}
```

Channel numbers are the order in the file. Channel 00 is the test card (`offair` in the data).

`"public": false` is the one-line off switch. Run `mv-publish` after changing it. With the flag off:

- the channel is left out of `channels.json`, so the page has no name, intro, titles or posters for it;
- its video folders are moved out of `public/` into `hidden/`, and the deploy takes them off the host;
- the deploy refuses to run if any deployed text or file name still carries the channel's name, a title or an artist, and afterwards `mv-publish live` checks both public hosts and the page for the same words and for 404s.

Setting it back to `true` and running `mv-publish` puts it all back.

`removalContact` at the top of the data is the address the notice line shows.

## Preview on the LAN

`music-videos/tools/mv-publish preview 8832` serves this checkout at `http://192.168.4.75:8832/music-videos/` with the media from the staging folder. It shows every channel; one that is switched off is badged HIDDEN.

- `?view=public` shows only what the data makes public.
- `?media=live` uses the real media host instead of the staging folder.
- `MV_PREVIEW_PUBLIC=1 mv-publish preview 8833` behaves like the public host: only `public/`, only public channels.

## Other commands

- `mv-publish --no-deploy`: encode and check, deploy nothing.
- `mv-publish check`: check the staging folder.
- `mv-publish live`: check the public hosts.

`mv-publish` never deletes anything. To encode a video again, move its folder out of `public/` or `hidden/` first.

## The player

Safari plays HLS itself; other browsers load `vendor/hls.light.min.js` (hls.js 1.6.13, Apache 2.0, licence beside it) when the first video starts. `?hlsjs=1` forces hls.js.

Deep links: `/music-videos/#song-name` or `/music-videos/?v=song-name`; a channel id works too.

Keys: up/down or PageUp/PageDown channel, left/right video, 0-9 channel number, space play/pause, J/L seek, F fullscreen, M mute. On a phone: swipe up/down for channel, left/right for video, tap for the controls.

No ads, no analytics, no third-party scripts. Keep it that way.
