import { describe, expect, it } from "vitest";
import { videoEmbed } from "./video";

describe("videoEmbed", () => {
  it("YouTube links of every shape, with a thumbnail", () => {
    for (const url of ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"]) {
      expect(videoEmbed(url), url).toEqual({
        provider: "YouTube",
        embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1",
        thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      });
    }
  });

  it("Vimeo, Loom and Google Drive", () => {
    expect(videoEmbed("https://vimeo.com/123456789")?.embedUrl).toBe("https://player.vimeo.com/video/123456789?autoplay=1");
    expect(videoEmbed("https://www.loom.com/share/0123456789abcdef0123456789abcdef")?.embedUrl).toBe("https://www.loom.com/embed/0123456789abcdef0123456789abcdef?autoplay=1");
    expect(videoEmbed("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view?usp=sharing")?.embedUrl).toBe(
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/preview",
    );
  });

  it("anything else can't be played on the page", () => {
    for (const url of [
      "http://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/short",
      "https://evil.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ\"><script>",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      expect(videoEmbed(url), url).toBeNull();
    }
  });
});
