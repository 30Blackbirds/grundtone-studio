export default defineTask({
  meta: { name: 'contract:ping', description: 'Extension contract fixture task' },
  run: () => ({ result: 'pong' }),
})
