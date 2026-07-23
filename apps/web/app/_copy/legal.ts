// apps/web/app/_copy/legal.ts
// Legal / policy copy. Kept as structured data (heading + ordered blocks) so the
// privacy page is a thin renderer and a later next-intl migration serializes it.
//
// This document is required for Google OAuth branding/verification of the Google
// Photos Picker integration. The "Google user data" section and the Limited Use
// disclosure are load-bearing for that review — do not weaken them without
// re-checking the Google API Services User Data Policy.

type Block = { p: string } | { list: readonly string[] };

export interface LegalSection {
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly Block[];
}

export const legal = {
  privacy: {
    title: "Privacy Policy",
    appName: "Tell Me Again",
    homeUrl: "https://tellmeagain.app",
    contactEmail: "privacy@tellmeagain.app",
    effectiveDate: "July 23, 2026",
    lastUpdated: "July 23, 2026",

    intro: [
      "Tell Me Again is a private place for families to record, keep, and share their stories. This Privacy Policy explains what information we collect, how we use it, and the choices you have. It applies to the Tell Me Again website and app at tellmeagain.app (the “Service”).",
      "We built Tell Me Again around a simple principle: your family's memories belong to your family. We do not sell your personal information, and we do not use the content you create to train third-party advertising or AI models.",
    ],

    sections: [
      {
        id: "information-we-collect",
        heading: "Information We Collect",
        blocks: [
          { p: "We collect only what we need to run the Service:" },
          {
            list: [
              "Account information — your name, email address, and date of birth, collected when you create an account or are invited to a family. Sign-in and authentication are handled by our authentication provider (Clerk).",
              "Mobile phone numbers — when you or a family member provide a number so we can send SMS text messages (for example, a family invitation link or account notice). See “Text Messaging (SMS)” below.",
              "Content you create — the stories, recordings, transcripts, photos, and captions you add, together with the people, families, and relationships you choose to record.",
              "Google Photos you select — when you choose to import from Google Photos, we receive only the specific photos you pick (see “Google User Data” below).",
              "Technical and usage data — basic, privacy-preserving analytics (such as page views and aggregate usage) and standard server logs used to keep the Service secure and reliable.",
            ],
          },
        ],
      },
      {
        id: "google-user-data",
        heading: "Google User Data",
        blocks: [
          {
            p: "Tell Me Again offers an optional feature that lets you add photos from your Google Photos library to your family album. This feature uses the Google Photos Picker API and requests a single, read-only scope: photospicker.mediaitems.readonly.",
          },
          {
            p: "When you use this feature, Google opens its own photo picker. We never see your full Google Photos library. We receive only the individual photos you explicitly select in that picker, and only for as long as it takes to copy them into your family album.",
          },
          { p: "We use the Google data we receive solely to:" },
          {
            list: [
              "Download the specific photos you selected and add them to your Tell Me Again family album, at your request.",
            ],
          },
          {
            p: "We do not use Google user data for advertising, and we do not sell it or transfer it to third parties except as needed to provide this feature (for example, our storage provider). We do not use Google user data to train machine-learning or AI models.",
          },
          {
            p: "Tell Me Again's use and transfer of information received from Google APIs to any other app will adhere to the Google API Services User Data Policy, including the Limited Use requirements.",
          },
          {
            p: "You can disconnect Google Photos at any time from within the app, and you can revoke Tell Me Again's access to your Google Account at https://myaccount.google.com/permissions. Photos you already imported remain in your album until you delete them.",
          },
        ],
      },
      {
        id: "text-messaging-sms",
        heading: "Text Messaging (SMS)",
        blocks: [
          {
            p: "Tell Me Again may send SMS text messages to mobile phone numbers that have been provided with consent to receive them. These messages are transactional and Service-related — for example, family invitation links and account or security notices. Message frequency varies. Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.",
          },
          {
            p: "The primary way to opt in is during account setup: when you add your mobile number and check the SMS consent box on the welcome screens. We may also send a one-time family invitation text when a family member confirms you have agreed to receive that invitation by SMS.",
          },
          {
            p: "You can opt out of Tell Me Again text messages at any time by replying STOP to any message from us. After you opt out, you will receive a confirmation and we will stop sending SMS to that number. You can reply HELP for help, or contact us at privacy@tellmeagain.app. You may also request removal of your number by emailing us.",
          },
          {
            p: "Mobile information and text messaging originator opt-in data and consent will not be shared with any third parties or affiliates for their marketing or promotional purposes. We do not sell, rent, or transfer SMS opt-in data or consent. Phone numbers may be processed by our SMS delivery provider solely to transmit messages you have consented to receive.",
          },
        ],
      },
      {
        id: "how-we-use-information",
        heading: "How We Use Your Information",
        blocks: [
          { p: "We use the information we collect to:" },
          {
            list: [
              "Provide the Service — save your stories and media, and show them to the family members you have chosen to share them with.",
              "Enable voice capture and story features — transcribe recordings and render them into readable stories using vendor services acting on our behalf.",
              "Keep the Service secure — authenticate you, prevent abuse, and diagnose problems.",
              "Communicate with you — send account, security, and Service-related messages by email and, where you have consented, by SMS text message (including family invitation links).",
            ],
          },
        ],
      },
      {
        id: "how-we-share",
        heading: "How Your Information Is Shared",
        blocks: [
          {
            p: "Sharing within your family is controlled by you. A story is visible to others only after you approve it for sharing and choose an audience (for example, your whole family or a chosen branch). Until then, only you can see it.",
          },
          {
            p: "We share information with service providers who process it on our behalf under confidentiality obligations — including hosting, database, storage, authentication, email, SMS delivery, transcription, and language-model providers. They may use your information only to provide services to us.",
          },
          {
            p: "We do not sell your personal information. We may disclose information if required by law, to protect the safety of people, or as part of a business transfer, and we will act to protect your information in any such event. The above excludes text messaging originator opt-in data and consent; this information will not be shared with any third parties.",
          },
        ],
      },
      {
        id: "service-providers",
        heading: "Third-Party Services We Use",
        blocks: [
          { p: "We rely on trusted providers to run the Service, including:" },
          {
            list: [
              "Vercel — application hosting and web analytics.",
              "Neon / Supabase — database hosting.",
              "Cloudflare R2 — storage of media files (recordings and photos).",
              "Clerk — account authentication.",
              "Twilio — SMS text message delivery, when a consented phone number is provided.",
              "Resend / Zoho — email delivery and business email.",
              "Google — the Google Photos Picker, when you choose to import photos.",
              "Groq, Anthropic, and ElevenLabs — transcription, story rendering, and voice features.",
            ],
          },
        ],
      },
      {
        id: "retention-deletion",
        heading: "Data Retention and Deletion",
        blocks: [
          {
            p: "We keep your information for as long as your account is active or as needed to provide the Service. You can delete individual stories, photos, and recordings at any time.",
          },
          {
            p: "You may request deletion of your account and associated personal content by contacting us. When content is erased, the underlying media is removed from storage. Some records may be retained where required for legal, security, or audit reasons. If you opt out of SMS, we retain enough information to honor that opt-out and avoid messaging you again.",
          },
        ],
      },
      {
        id: "your-rights",
        heading: "Your Choices and Rights",
        blocks: [
          {
            list: [
              "Access and correct — view and update your account details in the app.",
              "Delete — remove stories, photos, and recordings, or request account deletion.",
              "SMS opt-out — reply STOP to any Tell Me Again text message, or contact privacy@tellmeagain.app.",
              "Revoke Google access — disconnect Google Photos in the app or at myaccount.google.com/permissions.",
              "Control sharing — decide what is shared, with whom, and withdraw consent by removing or unsharing content.",
            ],
          },
          {
            p: "Depending on where you live, you may have additional rights under laws such as the GDPR or CCPA. Contact us to exercise them.",
          },
        ],
      },
      {
        id: "security",
        heading: "How We Protect Your Information",
        blocks: [
          {
            p: "We use industry-standard measures to protect your information, including encryption in transit, encryption of stored access tokens, and access controls that ensure content is only served to authorized viewers. No system is perfectly secure, but we work to safeguard your family's memories.",
          },
        ],
      },
      {
        id: "children",
        heading: "Children's Privacy",
        blocks: [
          {
            p: "Tell Me Again is intended to be used by adults. Stories about children may be recorded by the adults responsible for them. We do not knowingly allow children to create their own accounts, and we do not knowingly collect personal information directly from children. If you believe a child has provided us information, contact us and we will remove it.",
          },
        ],
      },
      {
        id: "changes",
        heading: "Changes to This Policy",
        blocks: [
          {
            p: "We may update this Privacy Policy from time to time. When we make material changes, we will update the “Last updated” date above and, where appropriate, notify you. Your continued use of the Service after changes take effect means you accept the updated policy.",
          },
        ],
      },
      {
        id: "contact",
        heading: "Contact Us",
        blocks: [
          {
            p: "If you have questions about this Privacy Policy, SMS text messaging, or how we handle your information, contact us at privacy@tellmeagain.app.",
          },
        ],
      },
    ] satisfies readonly LegalSection[],
  },
} as const;
