export function SupportPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6 text-gray-300">
      <h1 className="text-3xl font-bold text-white">Support</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Get help</h2>
        <p>
          For questions, bug reports, or feature requests, open an issue on GitHub or email us
          directly.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">GitHub</h2>
        <p>
          <a
            href="https://github.com/BLANXLAIT/openbrain/issues"
            className="text-purple-400 hover:text-purple-300"
            target="_blank"
            rel="noopener noreferrer"
          >
            github.com/BLANXLAIT/openbrain/issues
          </a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Email</h2>
        <p>
          <a href="mailto:hello@blanxlait.ai" className="text-purple-400 hover:text-purple-300">
            hello@blanxlait.ai
          </a>
        </p>
      </section>
    </div>
  );
}
