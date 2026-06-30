import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Use | Artifact Explorer',
  description: 'Terms of Use for the Artifact Explorer application',
};

export default function TermsPage() {
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

      <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
        <div className="prose max-w-none dark:prose-invert">
          <p className="text-gray-600 dark:text-gray-400 italic mb-8">
            Effective Date: June 30, 2026
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">1. Acceptance of Terms</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            By accessing and using Artifact Explorer, you agree to these Terms of Use. If you do not agree with these terms, you must not use the application.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">2. Use of the Platform</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            Artifact Explorer is provided for informational and exploratory purposes. It does not modify registry data and should not be used for unauthorized or malicious purposes. You agree not to:
          </p>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300">
            <li>Attempt unauthorized access to systems or data</li>
            <li>Use the application for illegal or unethical purposes</li>
            <li>Probe, attack, or tamper with the infrastructure of this deployment beyond intended public usage</li>
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
            We may update these Terms of Use at any time. Changes will be reflected on this page. Continued use of the platform after changes constitutes acceptance of the new terms.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">8. Contact</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            If you have questions or concerns about these Terms, please reach out to the admin.
          </p>
        </div>
      </div>
    </div>
  );
}
