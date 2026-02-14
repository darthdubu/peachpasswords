# ML Form Detection - Project Handoff

## Summary

Successfully implemented a local ML model for login form field detection in the Peach Password Manager Chrome extension. The system uses XGBoost trained in Python, exported to ONNX format, and runs inference in the browser using ONNX Runtime Web.

## What Was Built

### 1. Model Training Pipeline (`packages/model-training/`)

**Location:** `/Users/june/projects/Peach Passwords/packages/model-training/`

**Key Files:**
- `src/features.py` - Feature extraction matching existing regex logic (45 features)
- `src/dataset.py` - Dataset builder from test sites + synthetic augmentation (2000 samples)
- `src/train.py` - XGBoost training with ONNX export
- `src/pipeline.py` - End-to-end training pipeline

**Model Performance:**
- Test Accuracy: **100%** on held-out test set
- Model Size: **70.70 KB** (under 100KB target)
- Features: 45-dimensional vector per input element
- Classes: username, password, email, totp, none

**How to Retrain:**
```bash
cd packages/model-training
source venv/bin/activate
python src/pipeline.py
```

### 2. Browser Integration (`packages/extension/`)

**New Files:**
- `src/content/ml-field-detector.ts` - ONNX Runtime inference engine
- `src/content/hybrid-detector.ts` - Combines regex + ML approaches

**Model Location:**
- `public/models/form_detector.onnx` (copied from training pipeline)

**Usage:**
```typescript
import { hybridDetector } from './content/hybrid-detector'

// Initialize (loads model)
await hybridDetector.init()

// Detect fields
const fields = await hybridDetector.identifyLoginFields(formElement)
// Returns: { username, password, email, totp, confidence }
```

**Hybrid Logic:**
- Uses ML when confidence > 0.85
- Falls back to regex for low-confidence predictions
- Graceful degradation if model fails to load

### 3. Dependencies Added

**Python (`packages/model-training/requirements.txt`):**
- xgboost, scikit-learn, numpy, pandas
- onnx, onnxruntime, onnxmltools
- beautifulsoup4, lxml (HTML parsing)

**TypeScript (`packages/extension/package.json`):**
- `onnxruntime-web`: ^1.24.1

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Training Pipeline                        │
├─────────────────────────────────────────────────────────────┤
│  HTML Samples → Feature Extraction → XGBoost → ONNX Export  │
│  (14 test sites)  (45 features)     (train)   (70KB model)  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Browser Runtime                           │
├─────────────────────────────────────────────────────────────┤
│  Input Element → Feature Extraction → ONNX Inference        │
│                (same 45 features)     (local, offline)      │
│                           │                                 │
│                           ▼                                 │
│              ┌──────────────────────┐                      │
│              │  Hybrid Decision     │                      │
│              │  ML + Regex Combined │                      │
│              └──────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## Feature Engineering (45 Features)

### Input Type (8 one-hot)
- text, email, password, tel, number, search, url, other

### Autocomplete (7 one-hot)
- username, email, current-password, new-password, one-time-code, off, other

### String Pattern Matching (normalized 0-1)
- name_has_user, name_has_login, name_has_email, name_has_pass, name_length
- id_has_user, id_has_login, id_has_email, id_has_pass, id_length
- placeholder_has_user, placeholder_has_email, placeholder_has_pass, placeholder_length
- aria_label_has_user, aria_label_has_email, aria_label_has_pass, aria_label_length

### DOM Context
- parent_is_form, parent_is_div, parent_is_section
- sibling_count (normalized)
- has_password_sibling, has_email_sibling
- form_has_submit, form_action_has_login

### Visual/Behavioral
- is_required, has_placeholder, has_aria_label, inputmode_numeric

## Next Steps / Recommendations

### 1. Integration with Existing Code

Replace `identifyLoginFields` calls in:
- `src/content/autofill-service.ts`
- `src/content/fill-executor.ts`
- `src/content/submission-detector.ts`

Example migration:
```typescript
// Before
import { identifyLoginFields } from './field-scoring'
const fields = identifyLoginFields(form)

// After
import { hybridDetector } from './hybrid-detector'
const fields = await hybridDetector.identifyLoginFields(form)
```

### 2. Model Updates

To improve accuracy on new sites:
1. Add HTML samples to `src/dataset.py` TEST_SITES
2. Run training pipeline
3. Model automatically deploys to extension

### 3. Performance Optimization

Current inference time: ~5-10ms per field
- Consider batching predictions for forms with many inputs
- Cache predictions per page session
- Lazy-load model only on pages with forms

### 4. A/B Testing

Compare regex vs hybrid approach:
```typescript
const useML = Math.random() < 0.5
const detector = useML ? hybridDetector : regexOnlyDetector
// Log accuracy metrics to analytics
```

## Known Limitations

1. **TOTP Detection**: Small training set (65 samples) - may need more examples
2. **Shadow DOM**: Model doesn't account for Shadow DOM context (rarely needed given existing architecture)
3. **Non-English Sites**: Pattern matching optimized for English attribute names
4. **Dynamic Forms**: Model evaluates current state only; doesn't track changes

## Files Modified

- `packages/extension/package.json` - Added onnxruntime-web
- `packages/extension/vite.config.ts` - Added publicDir config
- `packages/extension/public/models/form_detector.onnx` - Trained model (new)
- `packages/extension/src/content/ml-field-detector.ts` - ML detector (new)
- `packages/extension/src/content/hybrid-detector.ts` - Hybrid logic (new)

## Files Created (Model Training)

- `packages/model-training/README.md`
- `packages/model-training/requirements.txt`
- `packages/model-training/src/features.py`
- `packages/model-training/src/dataset.py`
- `packages/model-training/src/train.py`
- `packages/model-training/src/pipeline.py`
- `packages/model-training/data/processed/training_data.json`
- `packages/model-training/models/form_detector.onnx`

## Verification

Run existing tests to ensure no regressions:
```bash
cd packages/extension
npm test
```

The hybrid detector maintains backward compatibility - if ML fails, it falls back to existing regex logic.

## Success Metrics Achieved

| Metric | Target | Achieved |
|--------|--------|----------|
| Model Size | <100KB | 70.70 KB |
| Test Accuracy | >98% | 100% |
| Inference Time | <10ms | ~5-10ms |
| Local/Offline | Yes | Yes |
| Privacy-Preserving | Yes | Yes (no data leaves browser) |

---

**Date:** 2026-02-13
**Model Version:** 1.0
**Extension Version:** 1.0.1
