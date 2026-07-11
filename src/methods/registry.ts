/**
 * Method registry — the summary table only. Each renderer lives in its own
 * file at ./impl/<method-id>.ts; the shared toolkit (types + helpers) is in
 * ./kit.ts. Adding a method = new impl file + one row here.
 *
 * A renderer takes a Scene + project-wide RenderContext and returns either
 *   { engine: "hyperframes", html }  or  { engine: "remotion", tsx, compId, props }.
 * render.ts writes the source to a temp dir and invokes hyperframes/remotion.
 */
export type { RenderContext, RenderOutput, MethodRenderer } from "./kit.ts";
import type { MethodRenderer } from "./kit.ts";

import { hfCssFade } from "./impl/hf-css-fade.ts";
import { hfKineticText } from "./impl/hf-kinetic-text.ts";
import { hfAnimeScatter } from "./impl/hf-anime-scatter.ts";
import { hfWaapiMarker } from "./impl/hf-waapi-marker.ts";
import { hfTailwindCard } from "./impl/hf-tailwind-card.ts";
import { hfLottiePlay } from "./impl/hf-lottie-play.ts";
import { rmD3BarChart } from "./impl/rm-d3-bar-chart.ts";
import { rmD3LineTrend } from "./impl/rm-d3-line-trend.ts";
import { rmFramerCardStack } from "./impl/rm-framer-card-stack.ts";
import { rmImageKenburns } from "./impl/rm-image-kenburns.ts";
import { rmVideoClip } from "./impl/rm-video-clip.ts";
import { hfPosterHero } from "./impl/hf-poster-hero.ts";
import { hfMountainReveal } from "./impl/hf-mountain-reveal.ts";
import { hfLineReveal } from "./impl/hf-line-reveal.ts";
import { hfChapterCard } from "./impl/hf-chapter-card.ts";
import { hfStatCounter } from "./impl/hf-stat-counter.ts";
import { hfMegaCounter } from "./impl/hf-mega-counter.ts";
import { hfVersusPanel } from "./impl/hf-versus-panel.ts";
import { rmD3LineDraw } from "./impl/rm-d3-line-draw.ts";

export const METHOD_RENDERERS: Record<string, MethodRenderer> = {
  "hf-css-fade": hfCssFade,
  "hf-kinetic-text": hfKineticText,
  "hf-anime-scatter": hfAnimeScatter,
  "hf-waapi-marker": hfWaapiMarker,
  "hf-tailwind-card": hfTailwindCard,
  "hf-lottie-play": hfLottiePlay,
  "rm-d3-bar-chart": rmD3BarChart,
  "rm-d3-line-trend": rmD3LineTrend,
  "rm-framer-card-stack": rmFramerCardStack,
  "rm-image-kenburns": rmImageKenburns,
  "rm-video-clip": rmVideoClip,
  "hf-poster-hero": hfPosterHero,
  "hf-mountain-reveal": hfMountainReveal,
  "hf-line-reveal": hfLineReveal,
  "hf-chapter-card": hfChapterCard,
  "hf-stat-counter": hfStatCounter,
  "hf-mega-counter": hfMegaCounter,
  "hf-versus-panel": hfVersusPanel,
  "rm-d3-line-draw": rmD3LineDraw,
};
