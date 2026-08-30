export default function HomePage() {
  return (
    <main>
      <h1>Application</h1>
      <p>
        L’application démarre. L’état de la connexion à la base est exposé sur{' '}
        <a href="/api/health">/api/health</a>.
      </p>
    </main>
  )
}
