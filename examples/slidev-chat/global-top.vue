<script setup>
import { computed, watchEffect } from 'vue'
import { useNav } from '@slidev/client'
import CheckHenChatPanel from '@checkhen/slidev-chat/panel'
import { chatServer, chatTicket } from './chat-config.js'

// The class chat runs down the right side of every slide. A slide hides it with
// `chat: false` in its frontmatter; the panel stays connected while hidden.
const { currentSlideRoute } = useNav()
const shown = computed(() => currentSlideRoute.value?.meta?.slide?.frontmatter?.chat !== false)
watchEffect(() => document.documentElement.classList.toggle('checkhen-chat-hidden', !shown.value))
</script>

<template>
  <CheckHenChatPanel v-show="shown" :server="chatServer" :ticket="chatTicket" />
</template>
