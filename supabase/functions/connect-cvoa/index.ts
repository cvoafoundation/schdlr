import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createConnector } from './handler.js';

// Publishable key only. CVOA credentials and its service key are never copied.
const CVOA_URL = 'https://mvlhtuoukhorxmmibruc.supabase.co';
const CVOA_PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12bGh0dW91a2hvcnhtbWlicnVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNjQ4NzEsImV4cCI6MjA5ODg0MDg3MX0.HnYsrsvmAiZfz5swjexaaIC6Bbe2l1syILxFaKiQZYM';
Deno.serve(createConnector({
  cvoa: (token: string) => createClient(CVOA_URL, CVOA_PUBLIC_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }),
  service: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } }),
}));
