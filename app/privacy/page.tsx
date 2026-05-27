import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Artifact Explorer',
  description: 'Privacy Policy for the Artifact Explorer application',
};

/**
 * Privacy Policy page — render-from-env template.
 *
 * This page is a TEMPLATE intended to be customised by the operator deploying
 * the application. Each fork is responsible for publishing a privacy policy
 * that accurately reflects ITS OWN data collection practices.
 *
 * Configure via environment variables:
 *   - NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE  (e.g. "January 1, 2026")
 *   - NEXT_PUBLIC_CONTACT_EMAIL           (e.g. "privacy@example.com")
 *   - NEXT_PUBLIC_CLARITY_PROJECT_ID      (only set if you actually use Microsoft Clarity)
 *
 * If the effective date is not configured, a visible warning banner is rendered
 * to make the template state obvious in any deployed environment.
 */
export default function PrivacyPage() {
  const effectiveDate = process.env.NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE;
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
  const clarityEnabled = !!process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
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

      <h1 className="text-3xl font-bold mb-6 text-gray-800 dark:text-gray-100">Privacy Policy</h1>

      {isTemplate && (
        <div className="mb-6 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 p-4">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            ⚠️ Template — replace before deploying
          </p>
          <p className="mt-2 text-sm text-amber-900 dark:text-amber-200">
            Set <code className="font-mono">NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE</code> and{' '}
            <code className="font-mono">NEXT_PUBLIC_CONTACT_EMAIL</code> in your environment
            and customise the text below to accurately reflect your own data-collection practices.
            Privacy/Terms text is your legal responsibility as the operator.
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
        <div className="prose max-w-none dark:prose-invert">
          <p className="text-gray-600 dark:text-gray-400 italic mb-8">
            Effective Date: {effectiveDate ?? '[set NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE]'}
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">1. Information We Collect</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            We may collect non-personally identifiable information about your interaction with the platform, including:
          </p>
          <ul className="list-disc pl-6 text-gray-700 dark:text-gray-300">
            <li>Pages visited and features used</li>
            <li>Session duration</li>
            <li>Clicks, scrolls, and user behavior</li>
            <li>Browser and device type</li>
            <li>IP address (anonymized)</li>
          </ul>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            We <strong>do not</strong> collect personal data like names, email addresses, or system-level access to your registry unless explicitly disclosed or required for debugging.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">2. How We Use Your Information</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            We use this information to understand usage patterns, improve usability, and ensure the security of the platform. No personally identifiable information is stored or sold.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">3. Data Storage</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            {clarityEnabled
              ? 'Analytics data is stored securely by trusted third-party services (like Microsoft Clarity) in accordance with their data handling policies. We do not store sensitive or identifiable information on our own servers.'
              : 'We do not store sensitive or identifiable information on our own servers. If this deployment enables a third-party analytics provider, data handling follows that provider\u2019s policies.'}
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">4. Cookies and Tracking</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            We may use cookies to remember preferences or improve performance. You can disable cookies in your browser, though some features may be limited.
          </p>

          {clarityEnabled && (
            <>
              <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">5. Third-Party Services</h2>
              <p className="mb-4 text-gray-700 dark:text-gray-300">
                We use <strong>Microsoft Clarity</strong> to better understand user behavior. Clarity provides anonymized analytics through tools like heatmaps and session replays.
              </p>
              <p className="mb-4 text-gray-700 dark:text-gray-300">
                By using this application, you agree to Microsoft&rsquo;s collection and use of your data as described in their{' '}
                <a href="https://privacy.microsoft.com/en-us/privacystatement" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Privacy Statement</a> and{' '}
                <a href="https://learn.microsoft.com/en-us/clarity/setup-and-installation/privacy-disclosure" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Clarity privacy disclosure</a>.
              </p>
              <p className="mb-4 text-gray-700 dark:text-gray-300">
                You can opt out of tracking by enabling &ldquo;Do Not Track&rdquo; in your browser settings.
              </p>
            </>
          )}

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">{clarityEnabled ? 6 : 5}. Data Security</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            We implement reasonable technical and organizational safeguards to protect your data. However, no online platform can be 100% secure, and we cannot guarantee absolute security.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">{clarityEnabled ? 7 : 6}. Your Rights</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            You have the right to request deletion of any data we control, or inquire about what is collected through third-party services. For such requests, please contact us using the information below.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">{clarityEnabled ? 8 : 7}. Children&rsquo;s Privacy</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            This application is not intended for use by children under the age of 13. We do not knowingly collect or solicit personal information from minors.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">{clarityEnabled ? 9 : 8}. Changes to This Policy</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            We may update this privacy policy periodically. All changes will be posted on this page, and continued use of the platform indicates acceptance of the revised policy.
          </p>

          <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-800 dark:text-gray-100">{clarityEnabled ? 10 : 9}. Contact Information</h2>
          <p className="mb-4 text-gray-700 dark:text-gray-300">
            For questions or concerns regarding this policy, please contact{' '}
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
