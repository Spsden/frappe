interface PlaceholderPageProps {
  eyebrow: string
  title: string
  description: string
}

export function PlaceholderPage({ eyebrow, title, description }: PlaceholderPageProps) {
  return (
    <section className="grid min-h-[calc(100vh-4rem)] place-items-center px-6 py-16">
      <div className="max-w-lg text-center">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
          {eyebrow}
        </p>
        <h2 className="mt-4 text-4xl font-black tracking-[-0.04em]">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-white/50">{description}</p>
      </div>
    </section>
  )
}
