<template>
  <div class="pointer-events-none fixed inset-0 overflow-hidden z-0">
    <div class="blob blob-a absolute -top-32 -left-32 w-[450px] h-[450px] rounded-full bg-violet-400/30 dark:bg-violet-700/45 blur-[100px]" />
    <div class="blob blob-b absolute -bottom-32 -right-32 w-[450px] h-[450px] rounded-full bg-indigo-400/30 dark:bg-indigo-700/45 blur-[100px]" />
    <div class="blob blob-c absolute top-1/2 left-1/4 w-64 h-64 rounded-full bg-blue-400/20 dark:bg-blue-600/30 blur-[80px]" />
  </div>
</template>

<style scoped>
/* Ambient drift — the blobs breathe and wander on long, offset loops so the
   background never sits perfectly still. Slow and low-contrast on purpose:
   felt more than seen. */
.blob { will-change: transform; }

.blob-a { animation: blob-a 26s ease-in-out infinite; }
.blob-b { animation: blob-b 32s ease-in-out infinite; }
.blob-c { animation: blob-c 22s ease-in-out infinite; }

@keyframes blob-a {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50%      { transform: translate3d(8%, 6%, 0) scale(1.12); }
}
@keyframes blob-b {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1.06); }
  50%      { transform: translate3d(-6%, -7%, 0) scale(0.9); }
}
@keyframes blob-c {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 1; }
  50%      { transform: translate3d(10%, -12%, 0) scale(1.2); opacity: 0.8; }
}

@media (prefers-reduced-motion: reduce) {
  .blob { animation: none; }
}
</style>
