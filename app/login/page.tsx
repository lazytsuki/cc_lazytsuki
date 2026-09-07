import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerAuthClient } from '@/src/lib/supabase/server'
import { MIN_PASSWORD_LENGTH } from '@/src/lib/auth/credentials'
import { login, signup } from './actions'
import { AuthSubmitButton } from './auth-submit-button'
import { RetniwSymbol } from '@/src/components/app-header'

export const dynamic = 'force-dynamic'

type LoginPageProps = {
  searchParams: Promise<{ error?: string; mode?: string; notice?: string }>
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: '邮箱或密码不正确。',
  'invalid-email': '请填写可用的邮箱。',
  'invalid-password': `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`,
  'password-mismatch': '两次输入的密码不一致。',
  'signup-failed': '没有完成注册，请稍后再试。',
  'confirm-failed': '确认链接已失效，请重新注册或登录。',
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createServerAuthClient()
  const { data } = await supabase.auth.getClaims()

  if (data?.claims?.sub) redirect('/')

  const { error, mode, notice } = await searchParams
  const isSignup = mode === 'signup'
  const errorMessage = error ? ERROR_MESSAGES[error] ?? '没有完成，请稍后再试。' : ''

  return (
    <main className="welcome-shell" id="main-content" tabIndex={-1}>
      <section className="welcome-intro" aria-labelledby="welcome-title">
        <p className="login-brand"><RetniwSymbol /><span>retniw</span></p>
        <h1 id="welcome-title">想法不必完整，<br />先留下一句。</h1>
        <p className="welcome-description">随手记下，慢慢接着写。回来的时候，<br className="welcome-line-break" />找回以前的原文，看看它们之间的联系。</p>
        <div className="welcome-principles">
          <p><span>写下</span>不需要标题，也不用先分类。</p>
          <p><span>继续</span>自己接着写，需要时再请AI帮忙。</p>
          <p><span>带走</span>原文和完整思考，随时可以导出。</p>
        </div>
      </section>
      <section className="panel welcome-account" aria-labelledby="login-title">
        <nav className="auth-mode-switch" aria-label="账号入口">
          <Link href="/login" aria-current={!isSignup ? 'page' : undefined}>登录</Link>
          <Link href="/login?mode=signup" aria-current={isSignup ? 'page' : undefined}>创建账号</Link>
        </nav>
        <h2 id="login-title">{isSignup ? '留一个自己的空间' : '欢迎回来'}</h2>
        <p className="muted">{isSignup ? '填写邮箱，设置自己的密码。' : '继续之前写下的内容。'}</p>
        {notice === 'check-email' ? (
          <p className="auth-notice" role="status">请查收确认邮件。完成确认后，就可以直接使用。</p>
        ) : null}
        <form action={isSignup ? signup : login} className="login-form">
          <label>
            邮箱
            <input
              name="email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'login-error' : undefined}
              required
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? 'login-error' : undefined}
              minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
              required
            />
          </label>
          {isSignup ? (
            <label>
              再输一次密码
              <input
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? 'login-error' : undefined}
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </label>
          ) : null}
          {error ? <p className="form-error" id="login-error" role="alert">{errorMessage}</p> : null}
          <AuthSubmitButton isSignup={isSignup} />
        </form>
        <p className="login-note">
          内容仅自己可见。主动使用AI，或开启回看后，必要原文会交给DeepSeek处理。请勿记录工作机密。
        </p>
      </section>
    </main>
  )
}
