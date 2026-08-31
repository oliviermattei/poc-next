import { authRoutePath } from '../../lib/auth'
import { AuthForm } from '../auth-form'

export default function SignUpPage() {
  return (
    <main>
      <h1>Créer un compte</h1>
      <AuthForm
        action={authRoutePath('signUp')}
        fields={[
          { name: 'email', label: 'Adresse email', type: 'email', autoComplete: 'email' },
          {
            name: 'password',
            label: 'Mot de passe',
            type: 'password',
            autoComplete: 'new-password',
          },
        ]}
        submitLabel="Créer le compte"
        successMessage="Compte créé. Vérifiez votre boîte email pour activer votre compte."
      />
      <p>
        <a href="/sign-in">J’ai déjà un compte</a>
      </p>
    </main>
  )
}
