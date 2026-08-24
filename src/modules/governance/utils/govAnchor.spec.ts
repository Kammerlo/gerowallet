// The DRep avatar source.
//
// This replaced `drepImageUrl`, which resolved through `safeExternalHref` and so
// allowed http(s) only. Roughly half of mainnet's DReps publish an `ipfs://`
// avatar, and those were discarded before `DRepAvatar` could map them onto the
// backend proxy — so a DRep with a picture rendered as one without, silently.
// The two properties below are the ones that must both hold: `ipfs://` survives,
// and a hostile scheme still does not.
import { describe, it, expect } from 'vitest';
import { drepImageSource } from './govAnchor';

const CID = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';

/** A CIP-119 record carrying whatever `contentUrl` the DRep published. */
const withImage = (contentUrl: unknown) => ({
  metadata: { meta_json: { body: { image: { contentUrl } } } },
});

describe('drepImageSource', () => {
  it('keeps an ipfs uri exactly as published, unmapped', () => {
    // Unmapped on purpose: `DRepAvatar` runs it through `toInAppUrl` and must
    // stay the single place that turns one into something loadable.
    expect(drepImageSource(withImage(`ipfs://${CID}`))).toBe(`ipfs://${CID}`);
  });

  it('keeps an http(s) url', () => {
    expect(drepImageSource(withImage('https://example.org/a.png'))).toBe('https://example.org/a.png');
  });

  it('drops a scheme the avatar could never load', () => {
    expect(drepImageSource(withImage('javascript:alert(1)'))).toBeUndefined();
    expect(drepImageSource(withImage('data:text/html,<script>x</script>'))).toBeUndefined();
  });

  it('is undefined when there is no picture, rather than an empty string', () => {
    expect(drepImageSource({})).toBeUndefined();
    expect(drepImageSource(null)).toBeUndefined();
    expect(drepImageSource(withImage('   '))).toBeUndefined();
    expect(drepImageSource(withImage(42))).toBeUndefined();
    expect(drepImageSource({ metadata: { meta_json: { body: {} } } })).toBeUndefined();
  });
});
