import { authRoutePath } from '../../lib/auth'
import { AuthForm } from '../auth-form'

export default function ForgotPasswordPage() {
  return (
    <main>
      <h1>Mot de passe oublié</h1>
      <AuthForm
        action={authRoutePath('requestPasswordReset')}
        fields={[{ name: 'email', label: 'Adresse email', type: 'email', autoComplete: 'email' }]}
        submitLabel="Recevoir un lien"
        // La réponse ne dit jamais si le compte existe : le message est le même
        // dans les deux cas (`docs/security.md` §7).
        successMessage="Si cette adresse a un compte, un lien de réinitialisation vient de partir."
      />
    </main>
  )
}
