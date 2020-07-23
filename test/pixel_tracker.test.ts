import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as PixelTracker from '../lib/pixel_tracker-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new PixelTracker.PixelTrackerStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
