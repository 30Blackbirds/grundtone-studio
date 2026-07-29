<script setup lang="ts">
  // Shared pre-login card (redesign R9, redesign-r9-auth.html): centered card
  // on the surface background — brand + language switch live in the auth
  // layout's header. Every auth-adjacent screen (login/signup/verify/forgot/
  // reset/invitations) renders inside this, so the pre-login surfaces can't
  // drift apart again (UX-audit findings #1/#11).
  defineProps<{ title: string }>()
</script>

<template>
  <div class="auth-card p-6 bg-surface-raised border rounded-lg">
    <h1 class="mt-0">{{ title }}</h1>
    <slot />
  </div>
</template>
