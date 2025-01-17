#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from '@aws-cdk/core'
import { PixelTrackerStack } from '../lib/pixel_tracker-stack'

const app = new cdk.App()
new PixelTrackerStack(app, 'PixelTrackerStack', {
  env: {
    region: 'us-west-2',
    account: '891150181192'
  }
})
