<script setup lang="ts">
  // Shared pre-login card (redesign R9, redesign-r9-auth.html): centered card
  // on the surface background — brand + language switch live in the auth
  // layout's header. Every auth-adjacent screen (login/signup/verify/forgot/
  // reset/invitations) renders inside this, so the pre-login surfaces can't
  // drift apart again (UX-audit findings #1/#11).
  defineProps<{ title: string }>()
</script>

<template>
  <div class="auth-card p-6 bg-surface-raised border">
    <!-- Self-hosted mark (see public/brand/VENDORED.md); decorative next to the title. -->
    <img src="/brand/logo-32x32.png" width="32" height="32" alt="" class="auth-card__logo" />
    <h1 class="auth-card__title">{{ title }}</h1>
    <slot />
  </div>
</template>
