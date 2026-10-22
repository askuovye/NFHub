import axios from 'axios'

// Cliente HTTP único da SPA. Os módulos (src/modules/*/api) usam esta instância
// em vez de criar a sua, para que auth, CSRF e tratamento de erro fiquem num só lugar.
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api/v1',
  withCredentials: true,
  withXSRFToken: true,
  headers: {
    Accept: 'application/json',
  },
})
