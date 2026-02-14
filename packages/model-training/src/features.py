"""Feature extraction module for login form field detection.

Mirrors the logic in the TypeScript field-scoring.ts file.
"""

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Any
from bs4 import BeautifulSoup, Tag
import numpy as np


@dataclass
class FieldFeatures:
    type_text: int = 0
    type_email: int = 0
    type_password: int = 0
    type_tel: int = 0
    type_number: int = 0
    type_search: int = 0
    type_url: int = 0
    type_other: int = 0
    auto_username: int = 0
    auto_email: int = 0
    auto_current_password: int = 0
    auto_new_password: int = 0
    auto_one_time_code: int = 0
    auto_off: int = 0
    auto_other: int = 0
    name_has_user: float = 0.0
    name_has_login: float = 0.0
    name_has_email: float = 0.0
    name_has_pass: float = 0.0
    name_length: float = 0.0
    id_has_user: float = 0.0
    id_has_login: float = 0.0
    id_has_email: float = 0.0
    id_has_pass: float = 0.0
    id_length: float = 0.0
    placeholder_has_user: float = 0.0
    placeholder_has_email: float = 0.0
    placeholder_has_pass: float = 0.0
    placeholder_length: float = 0.0
    aria_label_has_user: float = 0.0
    aria_label_has_email: float = 0.0
    aria_label_has_pass: float = 0.0
    aria_label_length: float = 0.0
    parent_is_form: int = 0
    parent_is_div: int = 0
    parent_is_section: int = 0
    sibling_count: float = 0.0
    has_password_sibling: int = 0
    has_email_sibling: int = 0
    form_has_submit: int = 0
    form_action_has_login: int = 0
    is_required: int = 0
    has_placeholder: int = 0
    has_aria_label: int = 0
    inputmode_numeric: int = 0

    def to_vector(self) -> np.ndarray:
        return np.array(
            [
                self.type_text,
                self.type_email,
                self.type_password,
                self.type_tel,
                self.type_number,
                self.type_search,
                self.type_url,
                self.type_other,
                self.auto_username,
                self.auto_email,
                self.auto_current_password,
                self.auto_new_password,
                self.auto_one_time_code,
                self.auto_off,
                self.auto_other,
                self.name_has_user,
                self.name_has_login,
                self.name_has_email,
                self.name_has_pass,
                self.name_length,
                self.id_has_user,
                self.id_has_login,
                self.id_has_email,
                self.id_has_pass,
                self.id_length,
                self.placeholder_has_user,
                self.placeholder_has_email,
                self.placeholder_has_pass,
                self.placeholder_length,
                self.aria_label_has_user,
                self.aria_label_has_email,
                self.aria_label_has_pass,
                self.aria_label_length,
                self.parent_is_form,
                self.parent_is_div,
                self.parent_is_section,
                self.sibling_count,
                self.has_password_sibling,
                self.has_email_sibling,
                self.form_has_submit,
                self.form_action_has_login,
                self.is_required,
                self.has_placeholder,
                self.has_aria_label,
                self.inputmode_numeric,
            ],
            dtype=np.float32,
        )

    @classmethod
    def feature_names(cls) -> List[str]:
        return [
            "type_text",
            "type_email",
            "type_password",
            "type_tel",
            "type_number",
            "type_search",
            "type_url",
            "type_other",
            "auto_username",
            "auto_email",
            "auto_current_password",
            "auto_new_password",
            "auto_one_time_code",
            "auto_off",
            "auto_other",
            "name_has_user",
            "name_has_login",
            "name_has_email",
            "name_has_pass",
            "name_length",
            "id_has_user",
            "id_has_login",
            "id_has_email",
            "id_has_pass",
            "id_length",
            "placeholder_has_user",
            "placeholder_has_email",
            "placeholder_has_pass",
            "placeholder_length",
            "aria_label_has_user",
            "aria_label_has_email",
            "aria_label_has_pass",
            "aria_label_length",
            "parent_is_form",
            "parent_is_div",
            "parent_is_section",
            "sibling_count",
            "has_password_sibling",
            "has_email_sibling",
            "form_has_submit",
            "form_action_has_login",
            "is_required",
            "has_placeholder",
            "has_aria_label",
            "inputmode_numeric",
        ]


class FeatureExtractor:
    USERNAME_PATTERNS = [
        re.compile(r"user", re.I),
        re.compile(r"login", re.I),
        re.compile(r"usr", re.I),
        re.compile(r"uname", re.I),
        re.compile(r"account", re.I),
        re.compile(r"acct", re.I),
        re.compile(r"signin", re.I),
        re.compile(r"sign-in", re.I),
        re.compile(r"session", re.I),
        re.compile(r"member", re.I),
        re.compile(r"alias", re.I),
    ]

    EMAIL_PATTERNS = [
        re.compile(r"email", re.I),
        re.compile(r"e-mail", re.I),
        re.compile(r"mail", re.I),
    ]

    PASSWORD_PATTERNS = [
        re.compile(r"pass", re.I),
        re.compile(r"password", re.I),
        re.compile(r"pwd", re.I),
        re.compile(r"secret", re.I),
        re.compile(r"passphrase", re.I),
        re.compile(r"key", re.I),
        re.compile(r"credential", re.I),
    ]

    TOTP_PATTERNS = [
        re.compile(r"totp", re.I),
        re.compile(r"otp", re.I),
        re.compile(r"2fa", re.I),
        re.compile(r"mfa", re.I),
        re.compile(r"two-factor", re.I),
        re.compile(r"twofactor", re.I),
        re.compile(r"authenticat", re.I),
        re.compile(r"verification", re.I),
        re.compile(r"code", re.I),
        re.compile(r"pin", re.I),
        re.compile(r"token", re.I),
    ]

    def extract_from_element(
        self, input_elem: Tag, soup: Optional[BeautifulSoup] = None
    ) -> FieldFeatures:
        features = FieldFeatures()

        input_type = input_elem.get("type", "text").lower()
        self._set_input_type(features, input_type)

        autocomplete = input_elem.get("autocomplete", "")
        self._set_autocomplete(features, autocomplete)

        name = input_elem.get("name", "")
        features.name_has_user = self._match_score(name, self.USERNAME_PATTERNS)
        features.name_has_login = self._match_score(name, [re.compile(r"login", re.I)])
        features.name_has_email = self._match_score(name, self.EMAIL_PATTERNS)
        features.name_has_pass = self._match_score(name, self.PASSWORD_PATTERNS)
        features.name_length = len(name) / 50.0

        elem_id = input_elem.get("id", "")
        features.id_has_user = self._match_score(elem_id, self.USERNAME_PATTERNS)
        features.id_has_login = self._match_score(elem_id, [re.compile(r"login", re.I)])
        features.id_has_email = self._match_score(elem_id, self.EMAIL_PATTERNS)
        features.id_has_pass = self._match_score(elem_id, self.PASSWORD_PATTERNS)
        features.id_length = len(elem_id) / 50.0

        placeholder = input_elem.get("placeholder", "")
        features.placeholder_has_user = self._match_score(
            placeholder, self.USERNAME_PATTERNS
        )
        features.placeholder_has_email = self._match_score(
            placeholder, self.EMAIL_PATTERNS
        )
        features.placeholder_has_pass = self._match_score(
            placeholder, self.PASSWORD_PATTERNS
        )
        features.placeholder_length = len(placeholder) / 100.0

        aria_label = input_elem.get("aria-label", "")
        features.aria_label_has_user = self._match_score(
            aria_label, self.USERNAME_PATTERNS
        )
        features.aria_label_has_email = self._match_score(
            aria_label, self.EMAIL_PATTERNS
        )
        features.aria_label_has_pass = self._match_score(
            aria_label, self.PASSWORD_PATTERNS
        )
        features.aria_label_length = len(aria_label) / 100.0

        self._extract_context_features(features, input_elem)

        features.is_required = 1 if input_elem.get("required") else 0
        features.has_placeholder = 1 if placeholder else 0
        features.has_aria_label = 1 if aria_label else 0
        features.inputmode_numeric = (
            1 if input_elem.get("inputmode") == "numeric" else 0
        )

        return features

    def _set_input_type(self, features: FieldFeatures, input_type: str):
        type_mapping = {
            "text": "type_text",
            "email": "type_email",
            "password": "type_password",
            "tel": "type_tel",
            "number": "type_number",
            "search": "type_search",
            "url": "type_url",
        }
        if input_type in type_mapping:
            setattr(features, type_mapping[input_type], 1)
        else:
            features.type_other = 1

    def _set_autocomplete(self, features: FieldFeatures, autocomplete: str):
        auto = autocomplete.lower()
        if "username" in auto:
            features.auto_username = 1
        elif "email" in auto:
            features.auto_email = 1
        elif "current-password" in auto:
            features.auto_current_password = 1
        elif "new-password" in auto:
            features.auto_new_password = 1
        elif "one-time-code" in auto:
            features.auto_one_time_code = 1
        elif auto == "off":
            features.auto_off = 1
        else:
            features.auto_other = 1

    def _match_score(self, text: str, patterns: List[re.Pattern]) -> float:
        if not text:
            return 0.0
        matches = sum(1 for p in patterns if p.search(text))
        return min(matches / len(patterns) * 3, 1.0) if patterns else 0.0

    def _extract_context_features(self, features: FieldFeatures, input_elem: Tag):
        parent = input_elem.find_parent()
        if parent:
            parent_name = parent.name.lower() if parent.name else ""
            features.parent_is_form = 1 if parent_name == "form" else 0
            features.parent_is_div = 1 if parent_name == "div" else 0
            features.parent_is_section = 1 if parent_name == "section" else 0

            siblings = parent.find_all("input", recursive=False)
            features.sibling_count = len(siblings) / 10.0

            for sibling in siblings:
                if sibling != input_elem:
                    sibling_type = sibling.get("type", "").lower()
                    if sibling_type == "password":
                        features.has_password_sibling = 1
                    if sibling_type == "email":
                        features.has_email_sibling = 1

        form = input_elem.find_parent("form")
        if form:
            submit_btn = form.find(["button", "input"], attrs={"type": "submit"})
            features.form_has_submit = 1 if submit_btn else 0

            action = form.get("action", "")
            features.form_action_has_login = (
                1 if re.search(r"login|signin|auth|session", action, re.I) else 0
            )


def extract_features_from_html(html: str) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    extractor = FeatureExtractor()

    results = []
    for input_elem in soup.find_all("input"):
        input_type = input_elem.get("type", "text").lower()
        if input_type in ["hidden", "submit", "button", "image", "reset"]:
            continue

        features = extractor.extract_from_element(input_elem, soup)

        results.append(
            {
                "features": features,
                "element_id": input_elem.get("id", ""),
                "element_name": input_elem.get("name", ""),
                "input_type": input_type,
            }
        )

    return results
