library(plumber)
library(broom)

# In-memory dataset store
STONEWARE_DATA <- new.env(parent = emptyenv())

# -------- CORS filter --------
#* @filter cors
function(req, res) {
  res$setHeader("Access-Control-Allow-Origin", "*")
  res$setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
  res$setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  if (req$REQUEST_METHOD == "OPTIONS") { res$status <- 204; return(list()) }
  forward()
}

# -------- Health & hello --------
#* @get /health
function() list(status="ok", engine="plumber", language="R")

#* @get /hello
function(name="Stoneware") list(message=paste("Hello from R,", name, "👋"))

# -------- Robust multipart upload --------
# NOTE: We parse multipart and read from req$files to avoid httr/plumber edge cases.
#* @post /data/upload
#* @parser multi
#* @param name The dataset name to store in memory
function(req, name="my_data") {
  if (is.null(req$files) || length(req$files) == 0) stop("No file uploaded (multipart).")
  part <- req$files[["file"]]
  if (is.null(part)) part <- req$files[[1]]
  if (is.null(part$datapath) || !file.exists(part$datapath)) stop("Uploaded file missing datapath.")

  df <- tryCatch(
    utils::read.csv(part$datapath, stringsAsFactors=FALSE, check.names=FALSE),
    error=function(e) stop(paste("Failed to read CSV:", e$message))
  )
  assign(name, df, envir=STONEWARE_DATA)
  list(name=name, rows=nrow(df), cols=ncol(df), columns=unname(colnames(df)))
}

# -------- Linear analysis --------
#* @get /analyze/linear
#* @param data Dataset name (e.g., "mtcars" or uploaded name)
#* @param formula Model formula string (e.g., "mpg~wt+hp")
#* @param alpha Significance level for CIs
function(data="mtcars", formula="mpg~wt", alpha=0.05) {
  df <- if (exists(data, envir=STONEWARE_DATA, inherits=FALSE)) {
    get(data, envir=STONEWARE_DATA, inherits=FALSE)
  } else {
    switch(data, "mtcars"=mtcars, stop("Dataset not found. Upload with /data/upload or use data=mtcars"))
  }

  fit <- lm(as.formula(formula), data=df)
  summ <- broom::tidy(fit, conf.int=TRUE, conf.level=1 - as.numeric(alpha))
  gl   <- broom::glance(fit)

  list(
    r_code = sprintf("fit <- lm(%s, data = %s)", formula, data),
    model_summary = list(
      n = nrow(model.frame(fit)),
      r2 = unname(gl$r.squared),
      adj_r2 = unname(gl$adj.r.squared),
      sigma = unname(gl$sigma),
      f_stat = list(value=unname(gl$statistic), df1=unname(gl$df), df2=unname(gl$df.residual), p=unname(gl$p.value)),
      coefficients = lapply(seq_len(nrow(summ)), function(i) list(
        term = summ$term[i], estimate = unname(summ$estimate[i]), se = unname(summ$std.error[i]),
        t = unname(summ$statistic[i]), p = unname(summ$p.value[i]),
        ci = c(unname(summ$conf.low[i]), unname(summ$conf.high[i]))
      ))
    )
  )
}
# --- debug: what does the server see? ---
#* @post /debug/upload
#* @parser multi
function(req){
  list(
    content_type = req$HEADERS[["content-type"]],
    files = names(req$files),
    files_len = length(req$files),
    fields = names(req$args)
  )
}
# Accept CSV as plain text (fallback that works everywhere)
#* @post /data/upload_text
#* @parser text
#* @param name Dataset name to store
function(req, name="my_data"){
  txt <- req$postBody
  if (is.null(txt) || !nzchar(txt)) stop("Empty body: send text/csv")
  con <- textConnection(txt); on.exit(close(con), add=TRUE)
  df <- tryCatch(utils::read.csv(con, stringsAsFactors=FALSE, check.names=FALSE),
                 error=function(e) stop(paste("Failed to read CSV:", e$message)))
  assign(name, df, envir=STONEWARE_DATA)
  list(name=name, rows=nrow(df), cols=ncol(df), columns=unname(colnames(df)))
}

# -------- Diagnostics: residuals vs fitted and QQ plot --------
#* @get /analyze/diagnostics
#* @param data Dataset name
#* @param formula Model formula string
function(data="mtcars", formula="mpg~wt") {
  df <- if (exists(data, envir=STONEWARE_DATA, inherits=FALSE)) {
    get(data, envir=STONEWARE_DATA, inherits=FALSE)
  } else {
    switch(data, "mtcars"=mtcars, stop("Dataset not found. Upload with /data/upload_text or use data=mtcars"))
  }
  fit <- lm(as.formula(formula), data=df)

  to_data_url <- function(expr) {
    tf <- tempfile(fileext = ".png")
    png(tf, width = 800, height = 600, res = 120)
    on.exit(dev.off(), add=TRUE)
    eval.parent(substitute(expr))
    dev.off()
    enc <- base64enc::base64encode(tf)
    paste0("data:image/png;base64,", enc)
  }

  res_fit_png <- to_data_url({
    plot(fitted(fit), resid(fit),
         xlab = "Fitted values", ylab = "Residuals",
         main = "Residuals vs Fitted", pch = 19, col = "#3366AA88")
    abline(h = 0, lty = 2, col = "gray50")
  })

  qq_png <- to_data_url({
    qqnorm(resid(fit), main = "Normal Q-Q (Residuals)", pch = 19, col = "#3366AA88")
    qqline(resid(fit), col = "gray50", lty = 2, lwd = 2)
  })

  list(
    r_code = sprintf("fit <- lm(%s, data = %s)", formula, data),
    residuals_vs_fitted = res_fit_png,
    qq_plot = qq_png
  )
}
