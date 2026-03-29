export function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-8 space-y-6 text-gray-300">
      <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
      <p className="text-sm text-gray-500">Last updated: March 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">What we collect</h2>
        <p>
          Open Brain stores the thoughts, notes, and memories you explicitly capture. We also store
          your email address (from Google or Apple sign-in) to identify your account.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">How we use it</h2>
        <p>
          Your data is used solely to power your personal brain — semantic search, browsing, and AI
          chat. We do not sell your data, share it with third parties, or use it for advertising.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Where it's stored</h2>
        <p>
          Data is stored in AWS (us-east-1) using S3 Vectors for embeddings and DynamoDB for
          account information. All data is encrypted at rest and in transit.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">AI processing</h2>
        <p>
          When you chat with your brain or capture a thought, your text is sent to Amazon Bedrock
          (Claude and Titan Embed models) to generate responses and embeddings. AWS does not use
          this data to train foundation models.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Deleting your data</h2>
        <p>
          You can delete individual thoughts from the dashboard. To delete your account and all
          associated data, contact us at{" "}
          <a href="mailto:hello@blanxlait.ai" className="text-purple-400 hover:text-purple-300">
            hello@blanxlait.ai
          </a>
          .
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">Contact</h2>
        <p>
          Questions?{" "}
          <a href="mailto:hello@blanxlait.ai" className="text-purple-400 hover:text-purple-300">
            hello@blanxlait.ai
          </a>
        </p>
      </section>
    </div>
  );
}
