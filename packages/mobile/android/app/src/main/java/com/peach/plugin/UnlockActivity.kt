package com.peach.plugin

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

class UnlockActivity : Activity() {
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }
        
        val titleView = TextView(this).apply {
            text = "Unlock Peach Vault"
            textSize = 24f
            setPadding(0, 0, 0, 32)
        }
        
        val subtitleView = TextView(this).apply {
            text = "Enter your master password to continue"
            setPadding(0, 0, 0, 48)
        }
        
        val passwordInput = EditText(this).apply {
            hint = "Master password"
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD or 
                       android.text.InputType.TYPE_CLASS_TEXT
            setPadding(32, 32, 32, 32)
        }
        
        val unlockButton = Button(this).apply {
            text = "Unlock"
            setPadding(32, 32, 32, 32)
            setOnClickListener {
                val password = passwordInput.text.toString()
                if (password.isNotEmpty()) {
                    val success = VaultStorage.getInstance(this@UnlockActivity)
                        .unlock(password)
                    
                    if (success) {
                        Toast.makeText(this@UnlockActivity, "Unlocked", Toast.LENGTH_SHORT).show()
                        setResult(RESULT_OK)
                        finish()
                    } else {
                        Toast.makeText(this@UnlockActivity, "Incorrect password", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
        
        val cancelButton = Button(this).apply {
            text = "Cancel"
            setOnClickListener {
                setResult(RESULT_CANCELED)
                finish()
            }
        }
        
        layout.addView(titleView)
        layout.addView(subtitleView)
        layout.addView(passwordInput)
        layout.addView(unlockButton)
        layout.addView(cancelButton)
        
        setContentView(layout)
    }
}
