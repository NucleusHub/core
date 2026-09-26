<template>
  <div class="bd pointer-events-none fixed overflow-hidden z-0" aria-hidden="true">
    <div class="bd__base" />
    <div class="bd__light bd__light--a" />
    <div class="bd__orbit bd__orbit--far" />
    <div class="bd__dust bd__dust--far" />
    <div class="bd__grid"><div class="bd__grid-lines" /></div>
    <div class="bd__light bd__light--b" />
    <div class="bd__light bd__light--c" />
    <div class="bd__orbit bd__orbit--near" />
    <div class="bd__dust bd__dust--near" />
    <div class="bd__grain" />
    <div class="bd__vignette" />
  </div>
</template>

<style scoped>
/* Sized to lvh, not inset: 0, so the mobile URL bar resizing the viewport does not slide it. */
.bd {
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  height: 100lvh;
  background: #f4f3fa;
}
.dark .bd { background: #08060f; }

.bd__base {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 80% at 50% -10%, rgba(168, 85, 247, 0.10) 0%, transparent 62%),
    linear-gradient(180deg, #f6f5fb 0%, #f4f3fa 42%, #eceaf4 100%);
}
.dark .bd__base {
  background:
    radial-gradient(120% 80% at 50% -10%, rgba(38, 23, 74, 0.82) 0%, transparent 62%),
    linear-gradient(180deg, #0a0714 0%, #08060f 42%, #050309 100%);
}

.bd__light {
  position: absolute;
  border-radius: 50%;
  opacity: 0.55;
}
.dark .bd__light { opacity: 1; }

.bd__light--a {
  top: -22lvh;
  left: -8vw;
  width: 72vw;
  height: 72vw;
  max-width: 1040px;
  max-height: 1040px;
  background: radial-gradient(
    circle,
    rgba(139, 72, 246, 0.26) 0%,
    rgba(124, 58, 237, 0.17) 24%,
    rgba(88, 28, 190, 0.08) 48%,
    rgba(70, 22, 155, 0.028) 68%,
    transparent 84%
  );
}

.bd__light--b {
  right: -14vw;
  bottom: -26lvh;
  width: 68vw;
  height: 68vw;
  max-width: 960px;
  max-height: 960px;
  background: radial-gradient(
    circle,
    rgba(110, 114, 244, 0.21) 0%,
    rgba(88, 88, 214, 0.13) 26%,
    rgba(49, 46, 129, 0.07) 50%,
    rgba(40, 38, 110, 0.024) 70%,
    transparent 86%
  );
}

.bd__light--c {
  top: 46%;
  left: 22%;
  width: 42vw;
  height: 42vw;
  max-width: 580px;
  max-height: 580px;
  background: radial-gradient(
    circle,
    rgba(74, 141, 250, 0.16) 0%,
    rgba(48, 114, 240, 0.10) 26%,
    rgba(37, 99, 235, 0.04) 50%,
    rgba(30, 80, 200, 0.014) 70%,
    transparent 86%
  );
}

.bd__orbit {
  position: absolute;
  border-radius: 50%;
  opacity: 0.6;
}
.dark .bd__orbit { opacity: 1; }

.bd__orbit--far {
  top: 2lvh;
  left: 44%;
  width: 176vw;
  height: 108vw;
  border: 1px solid rgba(129, 140, 248, 0.34);
  transform: translate(-50%, -50%) rotate(-13deg);
  -webkit-mask-image: conic-gradient(
    from 150deg,
    #000 0deg, rgba(0, 0, 0, 0.62) 44deg, transparent 126deg,
    transparent 236deg, rgba(0, 0, 0, 0.55) 318deg, #000 360deg
  );
  mask-image: conic-gradient(
    from 150deg,
    #000 0deg, rgba(0, 0, 0, 0.62) 44deg, transparent 126deg,
    transparent 236deg, rgba(0, 0, 0, 0.55) 318deg, #000 360deg
  );
}

.bd__orbit--near {
  top: 9lvh;
  left: 41%;
  width: 118vw;
  height: 72vw;
  border: 1px solid rgba(168, 85, 247, 0.42);
  transform: translate(-50%, -50%) rotate(-19deg);
  -webkit-mask-image: conic-gradient(
    from 24deg,
    transparent 0deg, rgba(0, 0, 0, 0.7) 62deg, #000 118deg,
    rgba(0, 0, 0, 0.45) 196deg, transparent 262deg, transparent 360deg
  );
  mask-image: conic-gradient(
    from 24deg,
    transparent 0deg, rgba(0, 0, 0, 0.7) 62deg, #000 118deg,
    rgba(0, 0, 0, 0.45) 196deg, transparent 262deg, transparent 360deg
  );
}

.bd__dust {
  display: none;
  position: absolute;
  left: 0;
  right: 0;
  -webkit-mask-image: linear-gradient(
    90deg,
    #000 0%, rgba(0, 0, 0, 0.55) 22%, rgba(0, 0, 0, 0.28) 50%,
    rgba(0, 0, 0, 0.55) 78%, #000 100%
  );
  mask-image: linear-gradient(
    90deg,
    #000 0%, rgba(0, 0, 0, 0.55) 22%, rgba(0, 0, 0, 0.28) 50%,
    rgba(0, 0, 0, 0.55) 78%, #000 100%
  );
}
.dark .bd__dust { display: block; }

.bd__dust--far {
  top: 0;
  bottom: 0;
  background-size: 560px 560px;
  background-image:
    radial-gradient(1.0px 1.0px at 226px 412px, rgba(214, 204, 255, 0.24) 0%, transparent 100%),
    radial-gradient(1.1px 1.1px at 104px 513px, rgba(214, 204, 255, 0.21) 0%, transparent 100%),
    radial-gradient(1.2px 1.2px at 492px 425px, rgba(214, 204, 255, 0.19) 0%, transparent 100%),
    radial-gradient(1.0px 1.0px at 415px 279px, rgba(214, 204, 255, 0.24) 0%, transparent 100%),
    radial-gradient(1.4px 1.4px at 41px 412px, rgba(214, 204, 255, 0.14) 0%, transparent 100%),
    radial-gradient(1.2px 1.2px at 94px 275px, rgba(214, 204, 255, 0.20) 0%, transparent 100%),
    radial-gradient(1.2px 1.2px at 189px 207px, rgba(214, 204, 255, 0.20) 0%, transparent 100%),
    radial-gradient(1.3px 1.3px at 503px 193px, rgba(214, 204, 255, 0.16) 0%, transparent 100%),
    radial-gradient(1.1px 1.1px at 278px 14px, rgba(214, 204, 255, 0.21) 0%, transparent 100%),
    radial-gradient(1.1px 1.1px at 297px 113px, rgba(214, 204, 255, 0.21) 0%, transparent 100%),
    radial-gradient(1.0px 1.0px at 411px 72px, rgba(214, 204, 255, 0.24) 0%, transparent 100%),
    radial-gradient(1.0px 1.0px at 438px 509px, rgba(214, 204, 255, 0.26) 0%, transparent 100%),
    radial-gradient(1.3px 1.3px at 137px 72px, rgba(214, 204, 255, 0.16) 0%, transparent 100%),
    radial-gradient(1.1px 1.1px at 378px 370px, rgba(214, 204, 255, 0.22) 0%, transparent 100%),
    radial-gradient(1.2px 1.2px at 220px 310px, rgba(214, 204, 255, 0.18) 0%, transparent 100%),
    radial-gradient(1.0px 1.0px at 318px 280px, rgba(214, 204, 255, 0.24) 0%, transparent 100%),
    radial-gradient(1.0px 1.0px at 555px 541px, rgba(214, 204, 255, 0.25) 0%, transparent 100%),
    radial-gradient(1.2px 1.2px at 344px 508px, rgba(214, 204, 255, 0.19) 0%, transparent 100%),
    radial-gradient(1.1px 1.1px at 51px 191px, rgba(214, 204, 255, 0.22) 0%, transparent 100%),
    radial-gradient(1.4px 1.4px at 526px 69px, rgba(214, 204, 255, 0.14) 0%, transparent 100%),
    radial-gradient(1.0px 1.0px at 374px 183px, rgba(214, 204, 255, 0.26) 0%, transparent 100%),
    radial-gradient(1.0px 1.0px at 535px 308px, rgba(214, 204, 255, 0.24) 0%, transparent 100%);
}

.bd__dust--near {
  top: 0;
  bottom: 0;
  background-size: 380px 380px;
  background-image:
    radial-gradient(1.8px 1.8px at 134px 19px, rgba(232, 226, 255, 0.23) 0%, transparent 100%),
    radial-gradient(1.7px 1.7px at 108px 308px, rgba(232, 226, 255, 0.25) 0%, transparent 100%),
    radial-gradient(1.7px 1.7px at 296px 7px, rgba(232, 226, 255, 0.26) 0%, transparent 100%),
    radial-gradient(1.6px 1.6px at 327px 173px, rgba(232, 226, 255, 0.29) 0%, transparent 100%),
    radial-gradient(1.6px 1.6px at 277px 269px, rgba(232, 226, 255, 0.27) 0%, transparent 100%),
    radial-gradient(1.3px 1.3px at 56px 105px, rgba(232, 226, 255, 0.38) 0%, transparent 100%),
    radial-gradient(1.8px 1.8px at 13px 337px, rgba(232, 226, 255, 0.23) 0%, transparent 100%),
    radial-gradient(1.6px 1.6px at 17px 239px, rgba(232, 226, 255, 0.29) 0%, transparent 100%),
    radial-gradient(1.8px 1.8px at 221px 169px, rgba(232, 226, 255, 0.22) 0%, transparent 100%),
    radial-gradient(1.4px 1.4px at 222px 79px, rgba(232, 226, 255, 0.33) 0%, transparent 100%),
    radial-gradient(1.6px 1.6px at 211px 346px, rgba(232, 226, 255, 0.28) 0%, transparent 100%);
}

.bd__grid {
  position: absolute;
  inset: 0;
  overflow: hidden;
  -webkit-mask-image: radial-gradient(90% 65% at 50% 32%, #000 0%, transparent 78%);
  mask-image: radial-gradient(90% 65% at 50% 32%, #000 0%, transparent 78%);
}

.bd__grid-lines {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, rgba(24, 21, 38, 0.045) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(24, 21, 38, 0.045) 1px, transparent 1px);
  background-size: 88px 88px;
}
.dark .bd__grid-lines {
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.032) 1px, transparent 1px);
}

.bd__grain,
.bd__vignette {
  display: none;
  position: absolute;
  inset: 0;
}
.dark .bd__grain,
.dark .bd__vignette { display: block; }

.bd__grain {
  /* Plain, not overlay: overlay re-composites the whole backdrop on any change beneath. */
  opacity: 0.07;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E");
}

.bd__vignette {
  background: radial-gradient(120% 90% at 50% 40%, transparent 42%, rgba(4, 2, 10, 0.58) 100%);
}

@media (max-width: 720px) {
  .bd__grid-lines { background-size: 64px 64px; }
  .bd__orbit--far { width: 250vw; height: 168vw; }
  .bd__orbit--near { display: none; }
  .bd__dust--near { background-size: 300px 300px; }
}
</style>
