# AWS CDK Pixel Tracker

![Map of AWS Services in this project, from left to right: Browser, API Gateway, Kinesis Firehose, S3](readme/map.png)

This project is a simple implementation of a [pixel tracker](https://en.wikipedia.org/wiki/Web_beacon) using the [AWS CDK](https://aws.amazon.com/cdk/). This stack exports one API endpoint which returns a single-pixel transparent SVG when queried. All request metadata is then sent from the API gateway to Kinesis Firehose where it is collected and eventually cataloged in S3.

This project is still a work in progress, and the README will be updated as the project progresses.

![Pixel Tracker](https://track.prototypical.pro?source=github&repo=pixeltracker)
