"""Dataset builder for training the form field detection model.

Extracts data from existing test sites and generates synthetic variations.
"""

import json
import random
from typing import List, Dict, Any
from dataclasses import dataclass
from features import FieldFeatures, extract_features_from_html


@dataclass
class TrainingSample:
    features: FieldFeatures
    label: str
    source: str
    element_id: str = ""
    element_name: str = ""


TEST_SITES = [
    {
        "name": "GitHub Login",
        "url": "https://github.com/login",
        "labels": {
            "login": "username",
            "password": "password",
        },
        "html": """
        <form action="/session" method="post">
          <label for="login_field">Username or email address</label>
          <input type="text" name="login" id="login_field" autocomplete="username" />
          <label for="password">Password</label>
          <input type="password" name="password" id="password" autocomplete="current-password" />
          <input type="submit" name="commit" value="Sign in" />
        </form>
        """,
    },
    {
        "name": "Google Sign-in Step 1",
        "url": "https://accounts.google.com/signin",
        "labels": {
            "identifier": "email",
        },
        "html": """
        <form>
          <input type="email" name="identifier" autocomplete="username" aria-label="Email or phone" />
          <button type="button">Next</button>
        </form>
        """,
    },
    {
        "name": "Google Sign-in Step 2",
        "url": "https://accounts.google.com/signin/challenge",
        "labels": {
            "Passwd": "password",
        },
        "html": """
        <form>
          <input type="password" name="Passwd" autocomplete="current-password" aria-label="Enter your password" />
          <button type="submit">Next</button>
        </form>
        """,
    },
    {
        "name": "Microsoft Login",
        "url": "https://login.microsoftonline.com",
        "labels": {
            "loginfmt": "email",
            "passwd": "password",
        },
        "html": """
        <form>
          <input type="email" name="loginfmt" autocomplete="username" placeholder="Email, phone, or Skype" />
          <input type="password" name="passwd" autocomplete="current-password" />
          <button type="submit">Sign in</button>
        </form>
        """,
    },
    {
        "name": "AWS Console Login",
        "url": "https://signin.aws.amazon.com",
        "labels": {
            "username": "username",
            "password": "password",
        },
        "html": """
        <form id="signin_form">
          <input type="text" id="username" name="username" autocomplete="username" aria-label="Account ID" />
          <input type="password" id="password" name="password" autocomplete="current-password" />
          <button type="submit">Sign In</button>
        </form>
        """,
    },
    {
        "name": "Stripe Dashboard",
        "url": "https://dashboard.stripe.com/login",
        "labels": {
            "email": "email",
            "password": "password",
        },
        "html": """
        <form>
          <input type="email" name="email" autocomplete="username email" placeholder="Email" />
          <input type="password" name="password" autocomplete="current-password" />
          <button type="submit">Sign in to your account</button>
        </form>
        """,
    },
    {
        "name": "GitLab Login",
        "url": "https://gitlab.com/users/sign_in",
        "labels": {
            "user[login]": "username",
            "user[password]": "password",
        },
        "html": """
        <form>
          <input type="text" name="user[login]" autocomplete="username" placeholder="Username or email" />
          <input type="password" name="user[password]" autocomplete="current-password" placeholder="Password" />
          <button type="submit">Sign in</button>
        </form>
        """,
    },
    {
        "name": "Twitter/X Login",
        "url": "https://twitter.com/i/flow/login",
        "labels": {
            "text": "username",
            "password": "password",
        },
        "html": """
        <form>
          <input type="text" name="text" autocomplete="username" placeholder="Phone, email, or username" />
          <input type="password" name="password" autocomplete="current-password" />
          <button type="submit">Log in</button>
        </form>
        """,
    },
    {
        "name": "Netflix Login",
        "url": "https://www.netflix.com/login",
        "labels": {
            "userLoginId": "email",
            "password": "password",
        },
        "html": """
        <form>
          <input type="email" name="userLoginId" autocomplete="email" placeholder="Email or phone number" />
          <input type="password" name="password" autocomplete="current-password" placeholder="Password" />
          <button type="submit">Sign In</button>
        </form>
        """,
    },
    {
        "name": "Dropbox Login",
        "url": "https://www.dropbox.com/login",
        "labels": {
            "login_email": "email",
            "login_password": "password",
        },
        "html": """
        <form>
          <input type="email" name="login_email" autocomplete="username email" placeholder="Email" />
          <input type="password" name="login_password" autocomplete="current-password" placeholder="Password" />
          <button type="submit">Sign in</button>
        </form>
        """,
    },
    {
        "name": "Discord Login",
        "url": "https://discord.com/login",
        "labels": {
            "email": "email",
            "password": "password",
        },
        "html": """
        <form>
          <input type="email" name="email" autocomplete="email" placeholder="Email" />
          <input type="password" name="password" autocomplete="current-password" placeholder="Password" />
          <button type="submit">Log In</button>
        </form>
        """,
    },
    {
        "name": "Slack Login",
        "url": "https://slack.com/signin",
        "labels": {
            "email": "email",
        },
        "html": """
        <form>
          <input type="email" name="email" autocomplete="username email" placeholder="name@work-email.com" />
          <button type="submit">Sign In with Email</button>
        </form>
        """,
    },
    {
        "name": "2FA/TOTP Form",
        "url": "https://example.com/2fa",
        "labels": {
            "totpPin": "totp",
        },
        "html": """
        <form>
          <input type="tel" name="totpPin" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" placeholder="6-digit code" />
          <button type="submit">Verify</button>
        </form>
        """,
    },
    {
        "name": "Instagram Login",
        "url": "https://www.instagram.com/accounts/login",
        "labels": {
            "username": "username",
            "password": "password",
        },
        "html": """
        <form>
          <input type="text" name="username" autocomplete="username" placeholder="Phone number, username, or email" />
          <input type="password" name="password" autocomplete="current-password" placeholder="Password" />
          <button type="submit">Log In</button>
        </form>
        """,
    },
    {
        "name": "LinkedIn Login",
        "url": "https://www.linkedin.com/login",
        "labels": {
            "session_key": "username",
            "session_password": "password",
        },
        "html": """
        <form>
          <input type="text" name="session_key" autocomplete="username" placeholder="Email or phone" />
          <input type="password" name="session_password" autocomplete="current-password" placeholder="Password" />
          <button type="submit">Sign in</button>
        </form>
        """,
    },
]

NEGATIVE_EXAMPLES = [
    {
        "name": "Search Form",
        "html": """
        <form action="/search" method="get">
          <input type="text" name="q" placeholder="Search..." />
          <button type="submit">Search</button>
        </form>
        """,
    },
    {
        "name": "Newsletter Signup",
        "html": """
        <form>
          <input type="email" name="email" placeholder="Subscribe to newsletter" />
          <button type="submit">Subscribe</button>
        </form>
        """,
    },
    {
        "name": "Contact Form",
        "html": """
        <form>
          <input type="text" name="name" placeholder="Your name" />
          <input type="email" name="email" placeholder="Your email" />
          <textarea name="message"></textarea>
          <button type="submit">Send</button>
        </form>
        """,
    },
    {
        "name": "Address Form",
        "html": """
        <form>
          <input type="text" name="street" placeholder="Street address" />
          <input type="text" name="city" placeholder="City" />
          <input type="text" name="zip" placeholder="ZIP code" />
          <button type="submit">Continue</button>
        </form>
        """,
    },
    {
        "name": "Credit Card Form",
        "html": """
        <form>
          <input type="text" name="card_number" placeholder="Card number" />
          <input type="text" name="expiry" placeholder="MM/YY" />
          <input type="text" name="cvv" placeholder="CVV" />
          <button type="submit">Pay</button>
        </form>
        """,
    },
]


def build_dataset() -> List[TrainingSample]:
    samples = []

    for site in TEST_SITES:
        results = extract_features_from_html(site["html"])
        labels = site.get("labels", {})

        for result in results:
            element_name = result["element_name"]
            label = labels.get(element_name, "none")

            samples.append(
                TrainingSample(
                    features=result["features"],
                    label=label,
                    source=site["name"],
                    element_id=result["element_id"],
                    element_name=element_name,
                )
            )

    for example in NEGATIVE_EXAMPLES:
        results = extract_features_from_html(example["html"])
        for result in results:
            samples.append(
                TrainingSample(
                    features=result["features"],
                    label="none",
                    source=example["name"],
                    element_id=result["element_id"],
                    element_name=result["element_name"],
                )
            )

    return samples


def augment_dataset(
    samples: List[TrainingSample], target_size: int = 2000
) -> List[TrainingSample]:
    augmented = samples.copy()

    username_patterns = [
        "user",
        "login",
        "usr",
        "uname",
        "account",
        "acct",
        "signin",
        "member",
    ]
    email_patterns = ["email", "e-mail", "mail"]
    password_patterns = ["pass", "password", "pwd", "secret", "key"]
    totp_patterns = ["totp", "otp", "2fa", "code", "pin", "token"]

    while len(augmented) < target_size:
        base = random.choice(samples)

        if base.label == "none":
            continue

        new_features = FieldFeatures()
        for attr in dir(base.features):
            if not attr.startswith("_") and hasattr(new_features, attr):
                setattr(new_features, attr, getattr(base.features, attr))

        if random.random() < 0.3:
            new_features.auto_username = 0
            new_features.auto_email = 0
            new_features.auto_current_password = 0
            new_features.auto_other = 1

        if random.random() < 0.2 and base.label == "username":
            new_features.name_has_user = random.uniform(0.3, 0.8)
            new_features.name_has_login = random.uniform(0.3, 0.8)

        augmented.append(
            TrainingSample(
                features=new_features,
                label=base.label,
                source=f"{base.source}_augmented",
                element_id=base.element_id,
                element_name=base.element_name,
            )
        )

    return augmented


def save_dataset(samples: List[TrainingSample], path: str):
    data = []
    for sample in samples:
        row = {
            "features": sample.features.to_vector().tolist(),
            "label": sample.label,
            "source": sample.source,
            "element_id": sample.element_id,
            "element_name": sample.element_name,
        }
        data.append(row)

    with open(path, "w") as f:
        json.dump(data, f, indent=2)


if __name__ == "__main__":
    print("Building dataset from test sites...")
    samples = build_dataset()
    print(f"Base samples: {len(samples)}")

    print("Augmenting dataset...")
    augmented = augment_dataset(samples, target_size=2000)
    print(f"Total samples after augmentation: {len(augmented)}")

    label_counts = {}
    for s in augmented:
        label_counts[s.label] = label_counts.get(s.label, 0) + 1
    print(f"Label distribution: {label_counts}")

    save_dataset(augmented, "data/processed/training_data.json")
    print("Dataset saved to data/processed/training_data.json")
