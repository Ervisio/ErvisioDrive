# AWS Cognito integration

ErvisioDrive is an OpenID Connect relying party. Cognito authenticates users; ErvisioDrive still controls membership, workspace roles, file ACL and API permissions.

## 1. Configure AWS

1. Create or choose a **Cognito User Pool**. Require and verify the email attribute.
2. Create an app client. Enable the **authorization code grant**, and the `openid`, `email`, `profile` scopes. Enable the Cognito User Pool as an identity provider, plus any federation you intentionally need.
3. Configure a managed-login/hosted-UI domain.
4. Register the exact callback `https://YOUR_DRIVE/api/auth/callback/cognito` in the app client's allowed callback URLs. For development, use `http://localhost:3000/api/auth/callback/cognito`.
5. Choose either a confidential web client with a secret, or a public client without one. Both use PKCE in this application. Do not use the implicit flow.
6. Make `email` and its verification status available to the client. Configure MFA, password policy and sign-up policy in Cognito according to your organization.

## 2. Configure the service

```dotenv
COGNITO_ISSUER='https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_ExamplePool'
COGNITO_CLIENT_ID='your-client-id'
COGNITO_CLIENT_SECRET='your-secret'
```

For public clients, leave `COGNITO_CLIENT_SECRET` empty. The issuer is the User Pool issuer from Cognito's OIDC discovery document, **not** `https://your-domain.auth.eu-west-1.amazoncognito.com` and not an authorization endpoint.

Only expected AWS Cognito issuer hosts are accepted. Client secrets never enter browser bundles, settings responses or API logs. Use the host `.env` for credentials; the Settings panel can enable/disable the preconfigured provider without storing secrets in MongoDB.

```bash
docker compose up -d
```

The Cognito button appears when the issuer/client ID are valid and the provider is enabled in Settings. Callback URLs, external URL and HTTPS must agree. A changed issuer or subject is a different identity and is intentionally rejected for an already-linked account; changing identity associations requires a deliberate administrative database operation.

## 3. Authorize accounts

Whitelist each user's email in **Users and access**, then use **Continue with AWS Cognito**. A matching account requires `email_verified` to be the boolean `true`. A user who can register in Cognito but is not whitelisted cannot enter the drive.

On first successful login, the exact issuer + `sub` is pinned atomically to that whitelisted member. Later logins must match it. Cognito groups/roles never grant ErvisioDrive admin status. An ErvisioDrive admin assigns workspace roles.

Local email/password and Google can coexist with Cognito. Local login remains available for recovery. Signing out clears the ErvisioDrive session; it does not sign the user out of every AWS/SSO service. The upstream Cognito session may allow signing in again without entering credentials. Membership revocation is enforced in ErvisioDrive regardless of upstream sessions.

## API tokens are separate

Cognito ID/access tokens are not accepted by `/api/v1`. After signing in, create an ErvisioDrive API token with the exact scopes and resources needed by the integration. This ensures the same whitelist, revocation and resource checks apply to every machine request.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cognito button absent | Valid issuer/client ID, provider enabled, stack restarted |
| redirect_mismatch | Callback URL matches `NEXTAUTH_URL` + `/api/auth/callback/cognito` exactly |
| invalid_client | Correct client ID/secret pair; public client has no secret |
| Access denied after AWS login | Whitelist email, verified-email claim, pinned issuer/subject |
| User is not an administrator | Assign the workspace role in ErvisioDrive; Cognito groups are ignored |
| Sign-in immediately returns to AWS | Check the service URL, HTTPS proxy and state/PKCE/nonce cookies |

Official references: [authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html), [PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html), [app clients](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html).
