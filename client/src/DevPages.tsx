import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';

const DEV_BH_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImM4YTFhZmU4LTZjNjAtNGViOS1hZGVhLTE4NGY2M2Y0ZGFhZCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3h0c2didWlyaHd3cHhoempzaGhvLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI1ODgyNzZkOS0yOTUxLTQxYWMtODNiYS0wMzk0ODAzNzZiZDkiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzgxODc2NDk4LCJpYXQiOjE3ODE4NzI4OTgsImVtYWlsIjoiYWRtaW5AaW50ZXJpb3JzYnlkZXguY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbF92ZXJpZmllZCI6dHJ1ZX0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3ODE4NzI4OTh9XSwic2Vzc2lvbl9pZCI6IjliNTMwZWZjLTM1ZDMtNGUzMS1hNjUxLTYzMTdlMzRiN2E4YiIsImlzX2Fub255bW91cyI6ZmFsc2V9.dw9PFLnP4H4w-i8anKm9Z6tDiRBWv5ftgq13OjcwEuBnhpa-11R6EL5R8ffTDNTaPyHKHhOUQ94sSZt0pSZSoQ';
const DEV_BH_USER = {"id": "03a9a36c-6194-4762-b0fb-ada7f6dd45e2", "name": "Admin", "email": "admin@interiorsbydex.com", "role": "BRANCH_HEAD"};
const DEV_BL_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6ImM4YTFhZmU4LTZjNjAtNGViOS1hZGVhLTE4NGY2M2Y0ZGFhZCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3h0c2didWlyaHd3cHhoempzaGhvLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJkNzYzY2UxNy1iMWVlLTQwYzgtYmFhZS0yNzI0MmIxYjRkZTAiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzgxODc2NDk5LCJpYXQiOjE3ODE4NzI4OTksImVtYWlsIjoia2FydGhpa0BpbnRlcmlvcnNieWRleC5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsX3ZlcmlmaWVkIjp0cnVlfSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc4MTg3Mjg5OX1dLCJzZXNzaW9uX2lkIjoiY2JjMWVlMTAtMjQ0Zi00MzlhLWI1M2ItZTZjNjE3NTc4YWNiIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.w8C1kUBDx-sc0XForeiu_2OOq6nfQDftnqOdq2VDv8umK7OvxnccQx9Cc3fEkNveOYix74-ZfMqHbFCikoMtKg';
const DEV_BL_USER = {"id": "cmpxwha2f000n134rlklc665m", "name": "Karthik (BL)", "email": "karthik@interiorsbydex.com", "role": "BL"};

export function DevBHPage() {
  localStorage.setItem('crm_token', DEV_BH_TOKEN);
  localStorage.setItem('crm_user', JSON.stringify(DEV_BH_USER));
  return <Layout><Dashboard /></Layout>;
}

export function DevBLPage() {
  localStorage.setItem('crm_token', DEV_BL_TOKEN);
  localStorage.setItem('crm_user', JSON.stringify(DEV_BL_USER));
  return <Layout><Dashboard /></Layout>;
}

export function DevPipelinePage() {
  localStorage.setItem('crm_token', DEV_BH_TOKEN);
  localStorage.setItem('crm_user', JSON.stringify(DEV_BH_USER));
  return <Layout><Pipeline /></Layout>;
}
