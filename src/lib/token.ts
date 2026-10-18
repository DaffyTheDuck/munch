import { auth } from './firebase'

// Adds the signed-in user's Firebase ID token so the API server can verify who is calling.
export async function authHeader(): Promise<Record<string, string>> {
  try {
    const token = await auth?.currentUser?.getIdToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}
