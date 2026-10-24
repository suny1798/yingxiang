import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  async headers() {
    // 付款页面仅跳转托管Checkout，不加载Stripe.js；限制页面资源与表单来源。
    const value = "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.stripe.com https://*.link.com; frame-src https://*.stripe.com https://*.link.com; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'";
    return ['/pricing', '/account'].map((source) => ({ source, headers: [{ key: 'Content-Security-Policy', value }] }));
  },
};

export default config;
