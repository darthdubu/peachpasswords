# Model Training Package for Peach Password Manager

This package trains a machine learning model to detect login form fields.

## Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Usage

```bash
# Extract features from raw HTML data
python src/extract_features.py

# Train the model
python src/train.py

# Export to ONNX for browser use
python src/export.py

# Full pipeline
python src/pipeline.py
```

## Model Architecture

- **Algorithm**: XGBoost (Gradient Boosted Trees)
- **Features**: 30-dimensional vector per input element
- **Output**: Multi-class classification (username, password, email, totp, none)
- **Target Size**: <100KB (quantized INT8)

## Directory Structure

```
model-training/
├── src/
│   ├── extract_features.py    # Feature extraction from HTML
│   ├── train.py                # XGBoost training
│   ├── export.py               # ONNX export
│   └── pipeline.py             # End-to-end pipeline
├── data/
│   ├── raw/                    # HTML samples
│   ├── processed/              # Feature vectors (CSV/Parquet)
│   └── labels/                 # Ground truth annotations
├── models/                     # Trained models
└── tests/                      # Unit tests
```

## Feature Engineering

The model uses the following features extracted from each `<input>` element:

### Input Type (one-hot encoded)
- text, email, password, tel, number, search, url, other

### Autocomplete (categorical)
- username, email, current-password, new-password, one-time-code, off, other

### String Pattern Features (regex-based)
- name_has_user, name_has_login, name_has_email, name_has_pass
- id_has_user, id_has_login, id_has_email, id_has_pass
- placeholder_has_user, placeholder_has_email, placeholder_has_pass
- aria_label_has_user, aria_label_has_email, aria_label_has_pass

### DOM Context
- parent_tag_name (form, div, section, etc.)
- sibling_input_count
- has_password_sibling
- has_email_sibling
- form_has_submit_button
- form_action_contains_login

### Visual/Behavioral
- is_visible
- is_required
- has_placeholder
- has_aria_label

## License

Same as parent project (Peach Password Manager)
