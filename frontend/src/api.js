// Tiny fetch wrapper for the Scran JSON API.
// Cookies ride along automatically because the API is same-origin.

/**
 * Make an API request. Throws an Error with a readable message on any
 * non-2xx response; returns parsed JSON otherwise.
 */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data.detail) message = data.detail
    } catch {
      // Response wasn't JSON — keep the generic message.
    }
    const error = new Error(message)
    error.status = res.status
    throw error
  }
  return res.json()
}

/** Upload a single file as multipart form data (e.g. recipe photos). */
export function upload(path, fieldName, file) {
  return uploadMany(path, fieldName, [file])
}

/** Upload several files under one repeated field name (photo import). */
export async function uploadMany(path, fieldName, files) {
  const form = new FormData()
  for (const file of files) form.append(fieldName, file)
  const res = await fetch(path, { method: 'POST', body: form })
  if (!res.ok) {
    let message = `Upload failed (${res.status})`
    try {
      const data = await res.json()
      if (data.detail) message = data.detail
    } catch {
      // keep generic message
    }
    throw new Error(message)
  }
  return res.json()
}
