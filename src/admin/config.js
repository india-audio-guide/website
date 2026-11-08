/** Public Firebase web client config and API bases per environment.
 * apiKey values are the public client keys from bk-infra/scripts/iag-auth.mjs
 * (also shipped in the Android google-services.json files). They are not secrets.
 * Prod API bases stay empty until env_prod.dart is filled in; never copy dev URLs.
 */
export const ENVS = {
  dev: {
    name: "dev",
    firebase: {
      apiKey: 'AIzaSyC_PkzJ5dYd9rWfpvOFx2sLXCoW84j0d94',
      authDomain: "iag-dev-6612f.firebaseapp.com",
      projectId: "iag-dev-6612f",
    },
    apis: {
      user: "https://k1a5iqqe4g.execute-api.ap-south-2.amazonaws.com/dev",
      content: "https://5yhpykl6wg.execute-api.ap-south-2.amazonaws.com/dev",
      media: "https://5gtx4v9j10.execute-api.ap-south-2.amazonaws.com/dev",
      payment: "https://ecux84xks7.execute-api.ap-south-2.amazonaws.com/dev",
      cdn: "https://dxcoruk405jkd.cloudfront.net",
    },
  },
  prod: {
    name: "prod",
    firebase: {
      apiKey: 'AIzaSyAXGF2nCUHM8Whyeqk5kDCgilPfEYiE-Z8',
      authDomain: "iag-prod.firebaseapp.com",
      projectId: "iag-prod",
    },
    apis: {
      user: "",
      content: "",
      media: "",
      payment: "",
      cdn: "",
    },
  },
};
