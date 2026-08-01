interface PlaceholderPageProps {
  description: string
}

export function PlaceholderPage({ description }: PlaceholderPageProps) {
  return (
    <section className="grid min-h-[calc(100vh-4rem)] place-items-center px-6 py-8">
      <div className="max-w-lg text-center">
        <p className="text-sm leading-6 text-white/50">{description}</p>
      </div>
    </section>
  )
}
