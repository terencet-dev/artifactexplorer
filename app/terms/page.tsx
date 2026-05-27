import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use | Artifact Explorer',
  description: 'Terms of Use for the Artifact Explorer application',
};

/**
 * Terms of Use page — render-from-env template.
 *
 * Configure via:
 *   - NEXT_PUBLIC_TERMS_EFFECTIVE_DATE  (e.g. "January 1, 2026")
 *   - NEXT_PUBLIC_CONTACT_EMAIL         (e.g. "legal@example.com")
 *
 * If the effective date is not configured a visible warning banner is rendered
 * to make the template state obvious in any deployed environment.
 */
export default function TermsPage() {
  const effectiveDate = process.env.NEXT_PUBLIC_TERMS_EFFECTIVE_DATE;
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  const isTemplate = !effectiveDate;

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      <div className="mb-6">
        <Link
          href="/"
          className="text-blue-600 dark:text-blue-400 hover:underline flex items-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-1"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Home
        </Link>
      </div>

      <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-gray-100">Terms of Use</h1>

      {isTemplate && (
        <div className="mb-6 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 p-4">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            ⚠️ Template — replace before deploying
          </p>
          <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">
            Set <code className="font-mono">NEXT_PUBLIC_TERMS_EFFECTIVE_DATE</code> and{' '}
            <code className="font-mono">NEXT_PUBLIC_CONTACT_EMAIL</code> in your environment,
            then customise this text to suit your jurisdiction and offering.
            Terms of Use are the legal responsibility of the operator.
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
        <div className="prose max-w-none dark:prose-invert">
          <p className="text-gray-600 dark:text-gray-400 italic mb-8">
            Effective Date: {effectiveDate ?? '[set NEXT_PUBLIC_TERMS_EFFECTIVE_DATE]'}
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">1. Acceptance of Terms</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            By accessing and using this deployment of Artifact Explorer, you agree to these Terms of Use. If you do not agree, please do not use the application.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">2. Use of the Platform</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            Artifact Explorer is provided for informational and exploratory purposes. It does not modify registry data and should not be used for unauthorized or malicious purposes. You agree not to:
          </p>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300">
            <li>Attempt unauthorized access to systems or data</li>
            <li>Use the application for illegal or unethical purposes</li>
            <li>Probe or attack the infrastructure of this deployment beyond intended public usage</li>
          </ul>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">3. Availability</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            We strive to maintain uptime and reliability, but we do not guarantee continuous availability. Access may be suspended for maintenance, updates, or unforeseen issues.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">4. Disclaimer</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            The platform is provided <strong>&ldquo;as is&rdquo;</strong> without warranties of any kind, either express or implied. We make no guarantees about the accuracy, completeness, or performance of the tool.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">5. Limitation of Liability</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            To the fullest extent permitted by law, we are not liable for any direct, indirect, incidental, or consequential damages arising from your use or inability to use the platform.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">6. Open-Source Licensing</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            The Artifact Explorer source code is released under the <strong>MIT License</strong>. You are free to use,
            modify, and redistribute it in accordance with that license. Branding and trademarks (if any) used by an
            individual deployment may belong to the operator of that deployment.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">7. Changes to Terms</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            We may update these Terms of Use at any time. Changes will be reflected on this page. Continued use after changes constitutes acceptance of the new terms.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">8. Contact</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            For questions about these Terms, please contact{' '}
            {contactEmail ? (
              <a href={`mailto:${contactEmail}`} className="text-blue-600 dark:text-blue-400 hover:underline">{contactEmail}</a>
            ) : (
              <span className="italic text-amber-700 dark:text-amber-400">[set NEXT_PUBLIC_CONTACT_EMAIL to display a contact channel]</span>
            )}.
          </p>
        </div>
      </div>
    </div>
  );
}
