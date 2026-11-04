import { FooterComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** Pi 1.4 adapter: keep stock accounting, status rows, and footer ownership.
 * Only rearrange the stock renderer's two built-in lines. No widget APIs touched.
 * The roomy render prevents stock truncation from dropping usage fields.
 */
export default function (pi: ExtensionAPI) {
  let restore: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || restore) return;
    const original = FooterComponent.prototype.render;
    function render(this: FooterComponent, width: number): string[] {
      const normal = original.call(this, width);
      const roomy = original.call(this, 16384);
      const match = roomy[1]?.match(/^(.*?) {2,}(.*)$/);
      if (!match || width < 1) return normal;
      // Stock only shows provider when multiple providers are available.
      const model = (this as any).session.state.model;
      let identity = match[2].replaceAll(" • ", " · ");
      if (model && !identity.includes(`(${model.provider})`)) {
        identity = `(${model.provider}) ${identity}`;
      }
      // The model inherits dim from the stock padding we removed. Restore
      // the same ANSI prefix used by the stock directory row (including provider).
      const dimPrefix = roomy[0].match(/^(?:\x1b\[[0-9;]*m)+/)?.[0] ?? "";
      return [
        truncateToWidth(`${dimPrefix}${identity}    ${roomy[0]}`, width),
        ...wrapTextWithAnsi(match[1], width),
        ...normal.slice(2),
      ];
    }
    FooterComponent.prototype.render = render;
    restore = () => {
      if (FooterComponent.prototype.render === render) FooterComponent.prototype.render = original;
      restore = undefined;
    };
  });
  pi.on("session_shutdown", () => restore?.());
}
