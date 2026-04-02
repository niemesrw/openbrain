export function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6 text-white/80">
      <h1 className="text-3xl font-bold font-headline text-white">Terms of Service</h1>
      <p className="text-sm text-brain-muted/60 font-label">Last updated: March 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold font-headline text-white">Use of the service</h2>
        <p>
          Open Brain is a personal knowledge tool. You may use it to store and retrieve your own
          thoughts, notes, and memories. You are responsible for the content you capture.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold font-headline text-white">Your content</h2>
        <p>
          You own everything you capture. We do not claim any rights to your content. By using the
          service, you grant us a limited license to store and process your content solely to
          provide the service to you.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold font-headline text-white">Acceptable use</h2>
        <p>You agree not to use Open Brain to store or share illegal content, to attempt to
          access other users' data, or to interfere with the operation of the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold font-headline text-white">Availability</h2>
        <p>
          We aim for high availability but do not guarantee uninterrupted service. We may modify
          or discontinue features with reasonable notice.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold font-headline text-white">Limitation of liability</h2>
        <p>
          The service is provided "as is." BLANXLAIT is not liable for any loss of data or
          damages arising from use of the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold font-headline text-white">Contact</h2>
        <p>
          Questions?{" "}
          <a href="mailto:hello@example.com" className="text-brain-primary hover:text-brain-primary/80">
            hello@example.com
          </a>
        </p>
      </section>
    </div>
  );
}
