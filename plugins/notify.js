import axios from 'axios'

export async function sendNotification(report, config) {
  if (!report.action_required.failures) return
  const message = `Koda: ${report.action_required.failures} failure(s) on ${report.meta.commit}\n${report.action_required.suggested_focus.slice(0, 3).join('\n')}`
  const tasks = []
  if (config.notify?.telegram && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    tasks.push(axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TELEGRAM_CHAT_ID, text: message
    }))
  }
  if (config.notify?.discord && process.env.DISCORD_WEBHOOK_URL) {
    tasks.push(axios.post(process.env.DISCORD_WEBHOOK_URL, { embeds: [{ description: message, color: 0xff0000 }] }))
  }
  await Promise.allSettled(tasks)
}
